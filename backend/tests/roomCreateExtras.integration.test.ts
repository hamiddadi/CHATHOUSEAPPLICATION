import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { cancelEventReminder, shutdownReminders } =
  require('../src/queues/eventReminders') as typeof import('../src/queues/eventReminders');
const { shutdownReminder15 } =
  require('../src/extensions/queues/reminder15') as typeof import('../src/extensions/queues/reminder15');
const { notificationsService } =
  require('../src/modules/notifications/notifications.service') as typeof import('../src/modules/notifications/notifications.service');
const { NOTIFICATION_DELIVERY_TOPIC, wakeRoomInviteDelivery } =
  require('../src/modules/notifications/notification.outbox') as typeof import('../src/modules/notifications/notification.outbox');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const u = `cr_${rand()}`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: r.body.data.user.id as string, token: r.body.data.accessToken as string };
};

describe('CreateRoom — co-hosts + topics', () => {
  let app: Express;
  const createdUsers: string[] = [];
  const createdRooms: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdRooms) {
      await cancelEventReminder(id).catch(() => undefined);
    }
    await shutdownReminders();
    await shutdownReminder15();
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: createdRooms } } });
    for (const id of createdRooms) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUsers) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('creates inactive SPEAKER grants and activates one only after explicit join', async () => {
    const host = await register(app);
    const co1 = await register(app);
    const co2 = await register(app);
    createdUsers.push(host.id, co1.id, co2.id);

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Co-hosted launch',
        topics: ['tech', 'design'],
        // Include the host id to confirm it's stripped before insert.
        coHostIds: [co1.id, co2.id, host.id],
      });
    expect(res.status).toBe(201);
    const roomId = res.body.data.id as string;
    createdRooms.push(roomId);

    expect(res.body.data.topics).toEqual(['tech', 'design']);

    const participants = await prisma.participant.findMany({
      where: { roomId },
      select: { userId: true, role: true, leftAt: true },
    });
    const byUser = new Map(participants.map(participant => [participant.userId, participant]));
    expect(byUser.get(host.id)).toEqual(expect.objectContaining({ role: 'HOST', leftAt: null }));
    expect(byUser.get(co1.id)).toEqual(expect.objectContaining({ role: 'SPEAKER' }));
    expect(byUser.get(co1.id)?.leftAt).not.toBeNull();
    expect(byUser.get(co2.id)).toEqual(expect.objectContaining({ role: 'SPEAKER' }));
    expect(byUser.get(co2.id)?.leftAt).not.toBeNull();
    expect(res.body.data.participantCount).toBe(1);

    const seatedUsers = await prisma.user.findMany({
      where: { id: { in: [host.id, co1.id, co2.id] } },
      select: { id: true, currentRoomId: true },
    });
    expect(seatedUsers).toEqual(
      expect.arrayContaining([
        { id: host.id, currentRoomId: roomId },
        { id: co1.id, currentRoomId: null },
        { id: co2.id, currentRoomId: null },
      ]),
    );

    const tokenBeforeConsent = await request(app)
      .get(`/api/rooms/${roomId}/livekit-token`)
      .set('Authorization', `Bearer ${co1.token}`);
    expect(tokenBeforeConsent.status).toBe(403);
    expect(tokenBeforeConsent.body.error.code).toBe('ROOM_005');

    const join = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${co1.token}`);
    expect(join.status).toBe(200);
    expect(join.body.data.participantCount).toBe(2);
    expect(
      await prisma.participant.findUniqueOrThrow({
        where: { userId_roomId: { userId: co1.id, roomId } },
        select: { role: true, leftAt: true },
      }),
    ).toEqual({ role: 'SPEAKER', leftAt: null });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: co1.id },
        select: { currentRoomId: true },
      }),
    ).toEqual({ currentRoomId: roomId });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: co2.id },
        select: { currentRoomId: true },
      }),
    ).toEqual({ currentRoomId: null });

    // Each co-host received a ROOM_INVITE notification targeting this room.
    await new Promise(r => setTimeout(r, 50));
    const invites = await prisma.notification.findMany({
      where: { userId: { in: [co1.id, co2.id] }, type: 'ROOM_INVITE' },
    });
    expect(invites.length).toBeGreaterThanOrEqual(2);
    expect(invites.every(n => (n.data as { roomId?: string } | null)?.roomId === roomId)).toBe(
      true,
    );
  });

  it('keeps an invited SPEAKER grant dormant when the stage is already full', async () => {
    const host = await register(app);
    const cohost = await register(app);
    const filler = await register(app);
    createdUsers.push(host.id, cohost.id, filler.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Consent capacity', maxSpeakers: 1, coHostIds: [cohost.id] });
    expect(created.status).toBe(201);
    const roomId = created.body.data.id as string;
    createdRooms.push(roomId);

    const fillerJoin = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${filler.token}`);
    expect(fillerJoin.status).toBe(200);
    const promote = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ userId: filler.id, role: 'SPEAKER' });
    expect(promote.status).toBe(200);

    const rejectedJoin = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${cohost.token}`);
    expect(rejectedJoin.status).toBe(403);
    expect(rejectedJoin.body.error.code).toBe('ROOM_002');
    const dormantGrant = await prisma.participant.findUniqueOrThrow({
      where: { userId_roomId: { userId: cohost.id, roomId } },
      select: { role: true, leftAt: true },
    });
    expect(dormantGrant.role).toBe('SPEAKER');
    expect(dormantGrant.leftAt).not.toBeNull();
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: cohost.id },
        select: { currentRoomId: true },
      }),
    ).toEqual({ currentRoomId: null });
    expect(
      await prisma.room.findUniqueOrThrow({
        where: { id: roomId },
        select: { participantCount: true },
      }),
    ).toEqual({ participantCount: 2 });
  });

  it('persists invite + outbox atomically and repairs failed delivery on idempotency replay', async () => {
    const host = await register(app);
    const cohost = await register(app);
    createdUsers.push(host.id, cohost.id);
    const idempotencyKey = `cohost-delivery-${rand()}`;
    const payload = { title: 'Durable co-host invite', coHostIds: [cohost.id] };
    const delivery = jest
      .spyOn(notificationsService, 'deliverPersistedStrict')
      .mockRejectedValueOnce(new Error('simulated provider outage'));

    try {
      const first = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);
      expect(first.status).toBe(201);
      const roomId = first.body.data.id as string;
      createdRooms.push(roomId);

      const invite = await prisma.notification.findFirstOrThrow({
        where: {
          userId: cohost.id,
          actorId: host.id,
          type: 'ROOM_INVITE',
          targetId: roomId,
          targetType: 'room',
        },
      });
      expect(invite.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(invite.id).not.toContain(roomId);
      expect(invite.id).not.toContain(cohost.id);
      const failedEvent = await prisma.outboxEvent.findUniqueOrThrow({
        where: { eventKey: `notification-delivery:${invite.id}` },
      });
      expect(failedEvent.aggregateId).toBe(roomId);
      expect(failedEvent.payload).toEqual({ notificationId: invite.id });
      expect(failedEvent).toEqual(
        expect.objectContaining({ status: 'PENDING', attempts: 1, deliveredAt: null }),
      );

      const replay = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);
      expect(replay.status).toBe(201);
      expect(replay.body.data.id).toBe(roomId);
      expect(
        await prisma.notification.count({
          where: { type: 'ROOM_INVITE', targetId: roomId, userId: cohost.id },
        }),
      ).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: roomId } })).toBe(1);
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: failedEvent.id } })).toEqual(
        expect.objectContaining({ status: 'DELIVERED', attempts: 2 }),
      );

      const completedReplay = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);
      expect(completedReplay.status).toBe(201);
      expect(delivery).toHaveBeenCalledTimes(2);
    } finally {
      delivery.mockRestore();
    }
  });

  it('claims one delivery across concurrent Idempotency-Key replays', async () => {
    const host = await register(app);
    const cohost = await register(app);
    createdUsers.push(host.id, cohost.id);
    const idempotencyKey = `cohost-concurrent-delivery-${rand()}`;
    const payload = { title: 'Single claimed invite', coHostIds: [cohost.id] };
    let signalStarted!: () => void;
    let releaseDelivery!: () => void;
    const started = new Promise<void>(resolve => (signalStarted = resolve));
    const gate = new Promise<void>(resolve => (releaseDelivery = resolve));
    const delivery = jest
      .spyOn(notificationsService, 'deliverPersistedStrict')
      .mockImplementation(async () => {
        signalStarted();
        await gate;
        return true;
      });

    try {
      const firstRequest = request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .then(response => response);
      await started;
      const replay = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);
      expect(replay.status).toBe(201);
      releaseDelivery();
      const first = await firstRequest;
      expect(first.status).toBe(201);
      const roomId = first.body.data.id as string;
      createdRooms.push(roomId);
      expect(replay.body.data.id).toBe(roomId);
      expect(delivery).toHaveBeenCalledTimes(1);
      expect(await prisma.notification.count({ where: { targetId: roomId } })).toBe(1);
      expect(await prisma.outboxEvent.count({ where: { aggregateId: roomId } })).toBe(1);
    } finally {
      releaseDelivery();
      delivery.mockRestore();
    }
  });

  it('block-before-dispatch atomically removes the invite and replay becomes a no-op', async () => {
    const host = await register(app);
    const cohost = await register(app);
    createdUsers.push(host.id, cohost.id);
    const idempotencyKey = `cohost-block-delivery-${rand()}`;
    const payload = { title: 'Revoked co-host invite', coHostIds: [cohost.id] };
    const delivery = jest
      .spyOn(notificationsService, 'deliverPersistedStrict')
      .mockRejectedValueOnce(new Error('hold delivery until replay'));

    try {
      const first = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);
      expect(first.status).toBe(201);
      const roomId = first.body.data.id as string;
      createdRooms.push(roomId);
      expect(await prisma.notification.count({ where: { targetId: roomId } })).toBe(1);
      const grantBeforeBlock = await prisma.participant.findUniqueOrThrow({
        where: { userId_roomId: { userId: cohost.id, roomId } },
        select: { role: true, leftAt: true },
      });
      expect(grantBeforeBlock.role).toBe('SPEAKER');
      expect(grantBeforeBlock.leftAt).not.toBeNull();
      expect(
        await prisma.user.findUniqueOrThrow({
          where: { id: cohost.id },
          select: { currentRoomId: true },
        }),
      ).toEqual({ currentRoomId: null });

      const block = await request(app)
        .post(`/api/users/${host.id}/block`)
        .set('Authorization', `Bearer ${cohost.token}`);
      expect(block.status).toBe(200);
      expect(
        await prisma.notification.count({
          where: { userId: cohost.id, actorId: host.id, targetId: roomId },
        }),
      ).toBe(0);
      expect(
        await prisma.participant.findUnique({
          where: { userId_roomId: { userId: cohost.id, roomId } },
        }),
      ).toBeNull();
      expect(
        await prisma.user.findUniqueOrThrow({
          where: { id: cohost.id },
          select: { currentRoomId: true },
        }),
      ).toEqual({ currentRoomId: null });
      expect(
        await prisma.room.findUniqueOrThrow({
          where: { id: roomId },
          select: { participantCount: true },
        }),
      ).toEqual({ participantCount: 1 });

      const staleAudioGrant = await request(app)
        .get(`/api/rooms/${roomId}/livekit-token`)
        .set('Authorization', `Bearer ${cohost.token}`);
      expect(staleAudioGrant.status).toBe(403);
      expect(staleAudioGrant.body.error.code).toBe('ROOM_005');

      const replay = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${host.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);
      expect(replay.status).toBe(201);
      expect(delivery).toHaveBeenCalledTimes(1);
      expect(await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: roomId } })).toEqual(
        expect.objectContaining({ status: 'DELIVERED' }),
      );
    } finally {
      delivery.mockRestore();
    }
  });

  it('does not apply the co-host SPEAKER policy to an ordinary ROOM_INVITE outbox row', async () => {
    const sender = await register(app);
    const invitee = await register(app);
    createdUsers.push(sender.id, invitee.id);
    const aggregateId = `ordinary-room-invite-${rand()}`;
    const notification = await prisma.notification.create({
      data: {
        userId: invitee.id,
        actorId: sender.id,
        type: 'ROOM_INVITE',
        title: "You're invited",
        body: 'Ordinary invite without a co-host seat',
        data: { roomId: aggregateId, ping: true },
        targetId: aggregateId,
        targetType: 'room',
      },
    });
    await prisma.outboxEvent.create({
      data: {
        eventKey: `notification-delivery:${notification.id}`,
        topic: NOTIFICATION_DELIVERY_TOPIC,
        aggregateId,
        payload: { notificationId: notification.id },
      },
    });
    const delivery = jest
      .spyOn(notificationsService, 'deliverPersistedStrict')
      .mockResolvedValue(true);

    try {
      expect(await wakeRoomInviteDelivery(aggregateId)).toBe(1);
      expect(delivery).toHaveBeenCalledWith(expect.objectContaining({ id: notification.id }), {
        verifyExists: true,
      });
      expect(
        await prisma.notification.findUnique({ where: { id: notification.id } }),
      ).not.toBeNull();
      expect(
        await prisma.outboxEvent.findUniqueOrThrow({
          where: { eventKey: `notification-delivery:${notification.id}` },
        }),
      ).toEqual(expect.objectContaining({ status: 'DELIVERED' }));
    } finally {
      delivery.mockRestore();
      await prisma.outboxEvent.deleteMany({ where: { aggregateId } });
      await prisma.notification.deleteMany({ where: { id: notification.id } });
    }
  });

  it('validation: coHostIds containing "" is rejected', async () => {
    const host = await register(app);
    createdUsers.push(host.id);
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Empty id', coHostIds: [''] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  it('validation: topics cap at 5, coHostIds cap at 5', async () => {
    const host = await register(app);
    createdUsers.push(host.id);

    const tooManyTopics = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Too many tags',
        topics: ['a', 'b', 'c', 'd', 'e', 'f'],
      });
    expect(tooManyTopics.status).toBe(400);
    expect(tooManyTopics.body.error.code).toBe('VALIDATION_001');

    const tooManyCoHosts = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Huge cohost list',
        coHostIds: Array.from({ length: 6 }, (_, i) => `u${i}`),
      });
    expect(tooManyCoHosts.status).toBe(400);
    expect(tooManyCoHosts.body.error.code).toBe('VALIDATION_001');
  });

  it('unknown co-host ids are silently pruned — room creation still succeeds', async () => {
    const host = await register(app);
    const real = await register(app);
    createdUsers.push(host.id, real.id);

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Ghost cohost',
        coHostIds: [real.id, 'cm_nonexistent_id'],
      });
    expect(res.status).toBe(201);
    const roomId = res.body.data.id as string;
    createdRooms.push(roomId);

    const participants = await prisma.participant.findMany({
      where: { roomId },
      select: { userId: true, role: true, leftAt: true },
    });
    const ids = participants.map(p => p.userId);
    expect(ids).toContain(real.id);
    expect(ids).not.toContain('cm_nonexistent_id');
    expect(participants.find(participant => participant.userId === real.id)).toEqual(
      expect.objectContaining({ role: 'SPEAKER' }),
    );
    expect(participants.find(participant => participant.userId === real.id)?.leftAt).not.toBeNull();
  });

  it('live room grants only eligible co-hosts without teleporting even a busy invitee', async () => {
    const host = await register(app);
    const eligible = await register(app);
    const suspended = await register(app);
    const deleted = await register(app);
    const busy = await register(app);
    const blocked = await register(app);
    createdUsers.push(host.id, eligible.id, suspended.id, deleted.id, busy.id, blocked.id);

    const busyRoom = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${busy.token}`)
      .send({ title: 'Already occupied' });
    expect(busyRoom.status).toBe(201);
    createdRooms.push(busyRoom.body.data.id);

    await Promise.all([
      prisma.user.update({
        where: { id: suspended.id },
        data: { suspendedUntil: new Date(Date.now() + 60 * 60 * 1000) },
      }),
      prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } }),
      prisma.block.create({ data: { blockerId: host.id, blockedId: blocked.id } }),
    ]);

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Eligible co-hosts only',
        coHostIds: [eligible.id, suspended.id, deleted.id, busy.id, blocked.id],
      });
    expect(res.status).toBe(201);
    const roomId = res.body.data.id as string;
    createdRooms.push(roomId);

    const activeParticipants = await prisma.participant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true, role: true },
      orderBy: { userId: 'asc' },
    });
    expect(activeParticipants).toEqual([{ userId: host.id, role: 'HOST' }]);
    const grants = await prisma.participant.findMany({
      where: { roomId, leftAt: { not: null } },
      select: { userId: true, role: true },
      orderBy: { userId: 'asc' },
    });
    expect(grants).toEqual(
      [
        { userId: eligible.id, role: 'SPEAKER' as const },
        { userId: busy.id, role: 'SPEAKER' as const },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    );
    expect(res.body.data.participantCount).toBe(1);
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).participantCount).toBe(
      1,
    );

    const presence = await prisma.user.findMany({
      where: { id: { in: [host.id, eligible.id, suspended.id, deleted.id, busy.id, blocked.id] } },
      select: { id: true, currentRoomId: true },
    });
    const roomByUser = Object.fromEntries(presence.map(user => [user.id, user.currentRoomId]));
    expect(roomByUser[host.id]).toBe(roomId);
    expect(roomByUser[eligible.id]).toBeNull();
    expect(roomByUser[busy.id]).toBe(busyRoom.body.data.id);
    expect(roomByUser[suspended.id]).toBeNull();
    expect(roomByUser[deleted.id]).toBeNull();
    expect(roomByUser[blocked.id]).toBeNull();

    const invitees = await prisma.notification.findMany({
      where: { type: 'ROOM_INVITE', data: { path: ['roomId'], equals: roomId } },
      select: { userId: true },
    });
    expect(invitees.map(invite => invite.userId).sort()).toEqual([eligible.id, busy.id].sort());

    const busyJoin = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${busy.token}`);
    expect(busyJoin.status).toBe(409);
    expect(busyJoin.body.error.code).toBe('ROOM_012');
    expect(
      await prisma.participant.findUniqueOrThrow({
        where: { userId_roomId: { userId: busy.id, roomId } },
        select: { role: true, leftAt: true },
      }),
    ).toEqual(expect.objectContaining({ role: 'SPEAKER' }));
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: busy.id },
        select: { currentRoomId: true },
      }),
    ).toEqual({ currentRoomId: busyRoom.body.data.id });
  });

  it('concurrent live invitations create two inactive grants without changing presence', async () => {
    const hostA = await register(app);
    const hostB = await register(app);
    const shared = await register(app);
    createdUsers.push(hostA.id, hostB.id, shared.id);

    const [first, second] = await Promise.all([
      request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${hostA.token}`)
        .set('Idempotency-Key', `cohost-race-a-${rand()}`)
        .send({ title: 'Concurrent room A', coHostIds: [shared.id] }),
      request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${hostB.token}`)
        .set('Idempotency-Key', `cohost-race-b-${rand()}`)
        .send({ title: 'Concurrent room B', coHostIds: [shared.id] }),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const roomIds = [first.body.data.id as string, second.body.data.id as string];
    createdRooms.push(...roomIds);

    const sharedPresence = await prisma.user.findUniqueOrThrow({
      where: { id: shared.id },
      select: { currentRoomId: true },
    });
    expect(sharedPresence.currentRoomId).toBeNull();
    const grants = await prisma.participant.findMany({
      where: { roomId: { in: roomIds }, userId: shared.id },
      select: { roomId: true, role: true, leftAt: true },
      orderBy: { roomId: 'asc' },
    });
    expect(grants).toHaveLength(2);
    expect(grants.every(grant => grant.role === 'SPEAKER' && grant.leftAt !== null)).toBe(true);

    const rooms = await prisma.room.findMany({
      where: { id: { in: roomIds } },
      select: { participantCount: true },
    });
    expect(rooms.map(room => room.participantCount).sort()).toEqual([1, 1]);
  });

  it('scheduled room with co-hosts: no participants seated yet, but invites fire', async () => {
    const host = await register(app);
    const co = await register(app);
    createdUsers.push(host.id, co.id);

    const currentRoom = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${co.token}`)
      .send({ title: 'Current room before scheduled invite' });
    expect(currentRoom.status).toBe(201);
    createdRooms.push(currentRoom.body.data.id);

    const when = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Scheduled with cohost',
        scheduledFor: when,
        coHostIds: [co.id],
      });
    expect(res.status).toBe(201);
    const roomId = res.body.data.id as string;
    createdRooms.push(roomId);

    const participants = await prisma.participant.findMany({
      where: { roomId, leftAt: null },
    });
    expect(participants).toHaveLength(0);
    expect(res.body.data.participantCount).toBe(0);
    const scheduledSeat = await prisma.participant.findUnique({
      where: { userId_roomId: { userId: co.id, roomId } },
      select: { role: true, leftAt: true },
    });
    expect(scheduledSeat).toEqual(expect.objectContaining({ role: 'SPEAKER' }));
    expect(scheduledSeat?.leftAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: co.id } })).currentRoomId).toBe(
      currentRoom.body.data.id,
    );

    await new Promise(r => setTimeout(r, 50));
    const invite = await prisma.notification.findFirst({
      where: { userId: co.id, type: 'ROOM_INVITE' },
    });
    expect(invite).toBeTruthy();
  });

  it('feed scoring: structured topics match ranks a room above one with no match', async () => {
    const viewer = await register(app);
    const offTopicHost = await register(app);
    const onTopicHost = await register(app);
    createdUsers.push(viewer.id, offTopicHost.id, onTopicHost.id);

    const interests = await request(app)
      .patch('/api/users/me/interests')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ interests: ['music', 'travel', 'art'] });
    expect(interests.status).toBe(200);

    const offTopic = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${offTopicHost.token}`)
      .send({ title: 'Gardening', topics: ['plants'] });
    expect(offTopic.status).toBe(201);
    createdRooms.push(offTopic.body.data.id);

    const onTopic = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${onTopicHost.token}`)
      .send({ title: 'Nothing to see here', topics: ['music'] });
    expect(onTopic.status).toBe(201);
    createdRooms.push(onTopic.body.data.id);

    const feed = await request(app)
      .get('/api/rooms/feed')
      .set('Authorization', `Bearer ${viewer.token}`);
    const onIdx = feed.body.data.findIndex((r: { id: string }) => r.id === onTopic.body.data.id);
    const offIdx = feed.body.data.findIndex((r: { id: string }) => r.id === offTopic.body.data.id);
    expect(onIdx).toBeLessThan(offIdx);
  });
});
