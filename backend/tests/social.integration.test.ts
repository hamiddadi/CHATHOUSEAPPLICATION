import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { redis, connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { notificationsService } =
  require('../src/modules/notifications/notifications.service') as typeof import('../src/modules/notifications/notifications.service');
const { notifPrefsExtService } =
  require('../src/extensions/modules/notifPrefsExt/notifPrefsExt.service') as typeof import('../src/extensions/modules/notifPrefsExt/notifPrefsExt.service');
const { pushService } =
  require('../src/modules/push/push.service') as typeof import('../src/modules/push/push.service');
const { LIVEKIT_REVOCATION_TOPIC } =
  require('../src/modules/rooms/livekit-revocation.outbox') as typeof import('../src/modules/rooms/livekit-revocation.outbox');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const u = `soc_${rand()}`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({
      username: u,
      email: `${u}@test.local`,
      password: 'test-password-123',
    });
  return {
    id: r.body.data.user.id as string,
    token: r.body.data.accessToken as string,
  };
};

describe('Social actions — wave + block + report', () => {
  let app: Express;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterEach(async () => {
    // Wipe the wave rate-limit bucket between tests so each scenario
    // gets a fresh hour-window to hit.
    const keys = await redis.keys('wave:*');
    if (keys.length > 0) await redis.del(keys);
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('wave: creates a WAVE notification on the target; re-wave within window → USER_005', async () => {
    const a = await register(app);
    const b = await register(app);
    createdIds.push(a.id, b.id);

    const follow = await request(app)
      .post(`/api/follow/${b.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(follow.status).toBe(200);

    const first = await request(app)
      .post(`/api/users/${b.id}/wave`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(first.status).toBe(200);
    expect(first.body.data.waved).toBe(true);

    // Notification row landed for b.
    await new Promise(r => setTimeout(r, 50)); // notificationsService.create is fire-and-forget
    const notif = await prisma.notification.findFirst({
      where: { userId: b.id, type: 'WAVE' },
    });
    expect(notif).toBeTruthy();
    expect((notif?.data as { waverId?: string } | null)?.waverId).toBe(a.id);

    // Second wave within the hour → 429 USER_005
    const again = await request(app)
      .post(`/api/users/${b.id}/wave`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('USER_005');
  });

  it('wave: a PENDING follow request does not authorize the social action', async () => {
    const a = await register(app);
    const b = await register(app);
    createdIds.push(a.id, b.id);
    await prisma.user.update({
      where: { id: b.id },
      data: { isPrivateAccount: true },
    });

    const follow = await request(app)
      .post(`/api/follow/${b.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(follow.body.data.requested).toBe(true);

    const wave = await request(app)
      .post(`/api/users/${b.id}/wave`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(wave.status).toBe(403);
    expect(wave.body.error.code).toBe('USER_006');
  });

  it('wave: self-wave returns USER_003', async () => {
    const a = await register(app);
    createdIds.push(a.id);
    const res = await request(app)
      .post(`/api/users/${a.id}/wave`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_003');
  });

  it('block: hard-breaks the follow graph in both directions', async () => {
    const a = await register(app);
    const b = await register(app);
    createdIds.push(a.id, b.id);

    // Mutual follows first.
    await request(app).post(`/api/follow/${b.id}`).set('Authorization', `Bearer ${a.token}`);
    await request(app).post(`/api/follow/${a.id}`).set('Authorization', `Bearer ${b.token}`);

    // a blocks b.
    const res = await request(app)
      .post(`/api/users/${b.id}/block`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.blocked).toBe(true);

    // No follows in either direction remain.
    const follows = await prisma.follow.findMany({
      where: {
        OR: [
          { followerId: a.id, followingId: b.id },
          { followerId: b.id, followingId: a.id },
        ],
      },
    });
    expect(follows).toHaveLength(0);
  });

  it('block: revokes a large scheduled co-host backlog with one bounded transaction', async () => {
    const blocker = await register(app);
    const host = await register(app);
    createdIds.push(blocker.id, host.id);

    const scheduledRoomIds = Array.from({ length: 120 }, () => randomUUID());
    const scheduledFor = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await prisma.room.createMany({
      data: scheduledRoomIds.map((id, index) => ({
        id,
        title: `Scheduled grant ${index}`,
        hostId: host.id,
        isLive: false,
        scheduledFor,
        participantCount: 0,
      })),
    });
    await prisma.participant.createMany({
      data: scheduledRoomIds.map(roomId => ({
        roomId,
        userId: blocker.id,
        role: 'SPEAKER' as const,
        leftAt: new Date(),
      })),
    });

    const activeRoomId = randomUUID();
    await prisma.room.create({
      data: {
        id: activeRoomId,
        title: 'Active co-host grant',
        hostId: host.id,
        participantCount: 2,
        participants: {
          create: [
            { userId: host.id, role: 'HOST' },
            { userId: blocker.id, role: 'SPEAKER' },
          ],
        },
      },
    });
    await prisma.user.updateMany({
      where: { id: { in: [blocker.id, host.id] } },
      data: { currentRoomId: activeRoomId },
    });

    const response = await request(app)
      .post(`/api/users/${host.id}/block`)
      .set('Authorization', `Bearer ${blocker.token}`);

    expect(response.status).toBe(200);
    expect(
      await prisma.participant.count({
        where: { userId: blocker.id, roomId: { in: [...scheduledRoomIds, activeRoomId] } },
      }),
    ).toBe(0);
    expect(
      await prisma.room.findUniqueOrThrow({
        where: { id: activeRoomId },
        select: { participantCount: true },
      }),
    ).toEqual({ participantCount: 1 });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: blocker.id },
        select: { currentRoomId: true },
      }),
    ).toEqual({ currentRoomId: null });

    const revocationRows = await prisma.outboxEvent.findMany({
      where: { topic: LIVEKIT_REVOCATION_TOPIC },
    });
    const transition = revocationRows.filter(row => {
      const payload = row.payload as { roomId?: string; userId?: string };
      return payload.roomId === activeRoomId && payload.userId === blocker.id;
    });
    expect(transition).toHaveLength(1);
    expect(transition[0]).toEqual(
      expect.objectContaining({
        eventKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      }),
    );
    expect(transition[0]?.aggregateId).toBe(transition[0]?.eventKey);
    await prisma.outboxEvent.deleteMany({
      where: { id: { in: transition.map(row => row.id) } },
    });
  });

  it('block: wins concurrent follow retries without leaving an edge or drifting counters', async () => {
    const follower = await register(app);
    const blocker = await register(app);
    createdIds.push(follower.id, blocker.id);

    const attempts = await Promise.all([
      request(app)
        .post(`/api/follow/${blocker.id}`)
        .set('Authorization', `Bearer ${follower.token}`),
      request(app)
        .post(`/api/users/${follower.id}/block`)
        .set('Authorization', `Bearer ${blocker.token}`),
      ...Array.from({ length: 4 }, () =>
        request(app)
          .post(`/api/follow/${blocker.id}`)
          .set('Authorization', `Bearer ${follower.token}`),
      ),
    ]);
    expect(attempts[1]?.status).toBe(200);
    expect(
      await prisma.block.count({
        where: { blockerId: blocker.id, blockedId: follower.id },
      }),
    ).toBe(1);
    expect(
      await prisma.follow.count({
        where: { followerId: follower.id, followingId: blocker.id },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: {
          type: { in: ['FOLLOW_REQUEST', 'NEW_FOLLOWER'] },
          OR: [
            { userId: blocker.id, actorId: follower.id },
            { userId: follower.id, actorId: blocker.id },
          ],
        },
      }),
    ).toBe(0);
    const [freshFollower, freshBlocker] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: follower.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: blocker.id } }),
    ]);
    expect(freshFollower.followingCount).toBe(0);
    expect(freshBlocker.followerCount).toBe(0);
  });

  it('block: deletes a committed private request before delayed fanout resumes', async () => {
    const requester = await register(app);
    const owner = await register(app);
    createdIds.push(requester.id, owner.id);
    await prisma.user.update({
      where: { id: owner.id },
      data: { isPrivateAccount: true },
    });

    let signalDeliveryStarted!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>(resolve => {
      signalDeliveryStarted = resolve;
    });
    const deliveryGate = new Promise<void>(resolve => {
      releaseDelivery = resolve;
    });
    const originalDelivery = notificationsService.deliverPersisted.bind(notificationsService);
    const delayedDelivery = jest
      .spyOn(notificationsService, 'deliverPersisted')
      .mockImplementation(async (row, options) => {
        signalDeliveryStarted();
        await deliveryGate;
        return originalDelivery(row, options);
      });

    try {
      const followPromise = request(app)
        .post(`/api/follow/${owner.id}`)
        .set('Authorization', `Bearer ${requester.token}`)
        .then(response => response);
      await deliveryStarted;

      const block = await request(app)
        .post(`/api/users/${requester.id}/block`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(block.status).toBe(200);

      releaseDelivery();
      const follow = await followPromise;
      expect(follow.status).toBe(200);
      expect(delayedDelivery).toHaveBeenCalledWith(expect.any(Object), { verifyExists: true });
      expect(
        await prisma.follow.count({
          where: { followerId: requester.id, followingId: owner.id },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { userId: owner.id, actorId: requester.id, type: 'FOLLOW_REQUEST' },
        }),
      ).toBe(0);
    } finally {
      releaseDelivery();
      delayedDelivery.mockRestore();
    }
  });

  it('block: exact badge recount wins when deletion commits after delivery revalidation', async () => {
    const requester = await register(app);
    const owner = await register(app);
    createdIds.push(requester.id, owner.id);
    await prisma.user.update({
      where: { id: owner.id },
      data: { isPrivateAccount: true },
    });
    await redis.set(`notif:unread:${owner.id}`, '0', { EX: 60 });

    let signalDeliveryBadge!: () => void;
    let releaseDeliveryBadge!: () => void;
    const deliveryReachedBadge = new Promise<void>(resolve => {
      signalDeliveryBadge = resolve;
    });
    const deliveryBadgeGate = new Promise<void>(resolve => {
      releaseDeliveryBadge = resolve;
    });
    const originalRefresh = notificationsService.refreshUnreadCount.bind(notificationsService);
    let interceptedDeliveryRefresh = false;
    const refresh = jest
      .spyOn(notificationsService, 'refreshUnreadCount')
      .mockImplementation(async userId => {
        if (userId === owner.id && !interceptedDeliveryRefresh) {
          interceptedDeliveryRefresh = true;
          signalDeliveryBadge();
          await deliveryBadgeGate;
        }
        return originalRefresh(userId);
      });

    try {
      const followPromise = request(app)
        .post(`/api/follow/${owner.id}`)
        .set('Authorization', `Bearer ${requester.token}`)
        .then(response => response);
      await deliveryReachedBadge;
      expect(
        await prisma.notification.count({
          where: { userId: owner.id, actorId: requester.id, type: 'FOLLOW_REQUEST' },
        }),
      ).toBe(1);

      const block = await request(app)
        .post(`/api/users/${requester.id}/block`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(block.status).toBe(200);
      expect(await redis.get(`notif:unread:${owner.id}`)).toBe('0');

      releaseDeliveryBadge();
      expect((await followPromise).status).toBe(200);
      expect(await redis.get(`notif:unread:${owner.id}`)).toBe('0');
      const unread = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${owner.token}`);
      expect(unread.body.data.count).toBe(0);
      expect(refresh.mock.calls.filter(([userId]) => userId === owner.id).length).toBeGreaterThan(
        1,
      );
    } finally {
      releaseDeliveryBadge();
      refresh.mockRestore();
    }
  });

  it('block: suppresses push when it commits during follow-notification preference checks', async () => {
    const requester = await register(app);
    const owner = await register(app);
    createdIds.push(requester.id, owner.id);
    await prisma.user.update({
      where: { id: owner.id },
      data: { isPrivateAccount: true },
    });

    let signalPreferenceCheck!: () => void;
    let releasePreferenceCheck!: () => void;
    const preferenceCheckStarted = new Promise<void>(resolve => {
      signalPreferenceCheck = resolve;
    });
    const preferenceGate = new Promise<void>(resolve => {
      releasePreferenceCheck = resolve;
    });
    const preference = jest
      .spyOn(notifPrefsExtService, 'canDeliver')
      .mockImplementation(async () => {
        signalPreferenceCheck();
        await preferenceGate;
        return true;
      });
    const dispatch = jest.spyOn(pushService, 'dispatchToUser');

    try {
      const followPromise = request(app)
        .post(`/api/follow/${owner.id}`)
        .set('Authorization', `Bearer ${requester.token}`)
        .then(response => response);
      await preferenceCheckStarted;

      const block = await request(app)
        .post(`/api/users/${requester.id}/block`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(block.status).toBe(200);

      releasePreferenceCheck();
      expect((await followPromise).status).toBe(200);
      expect(preference).toHaveBeenCalledWith(
        owner.id,
        'FOLLOW_REQUEST',
        expect.objectContaining({ actorId: requester.id }),
      );
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      releasePreferenceCheck();
      preference.mockRestore();
      dispatch.mockRestore();
    }
  });

  it('block: serializes against accepting a PENDING request', async () => {
    const requester = await register(app);
    const owner = await register(app);
    createdIds.push(requester.id, owner.id);
    await prisma.user.update({
      where: { id: owner.id },
      data: { isPrivateAccount: true },
    });
    const pending = await request(app)
      .post(`/api/follow/${owner.id}`)
      .set('Authorization', `Bearer ${requester.token}`);
    expect(pending.body.data.requested).toBe(true);

    await Promise.all([
      request(app)
        .post(`/api/follow/${requester.id}/accept`)
        .set('Authorization', `Bearer ${owner.token}`),
      request(app)
        .post(`/api/users/${requester.id}/block`)
        .set('Authorization', `Bearer ${owner.token}`),
    ]);

    expect(
      await prisma.follow.count({
        where: { followerId: requester.id, followingId: owner.id },
      }),
    ).toBe(0);
    const [freshRequester, freshOwner] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: requester.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
    ]);
    expect(freshRequester.followingCount).toBe(0);
    expect(freshOwner.followerCount).toBe(0);
  });

  it('block: excludes the blocked user from search (both directions)', async () => {
    const viewer = await register(app);
    const blocked = await register(app);
    createdIds.push(viewer.id, blocked.id);

    // Set a unique bio marker so the search finds them deterministically.
    const marker = `socblkzz${rand()}`;
    await prisma.user.update({
      where: { id: blocked.id },
      data: { bio: `keyword ${marker}` },
    });

    // Block, then search.
    await request(app)
      .post(`/api/users/${blocked.id}/block`)
      .set('Authorization', `Bearer ${viewer.token}`);

    const search = await request(app)
      .get(`/api/search?q=${marker}&type=users`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(search.status).toBe(200);
    const ids = (search.body.data.users as { id: string }[]).map(u => u.id);
    expect(ids).not.toContain(blocked.id);

    // And the inverse: the blocked user also doesn't see the viewer.
    await prisma.user.update({
      where: { id: viewer.id },
      data: { bio: `keyword ${marker}` },
    });
    const reverse = await request(app)
      .get(`/api/search?q=${marker}&type=users`)
      .set('Authorization', `Bearer ${blocked.token}`);
    const reverseIds = (reverse.body.data.users as { id: string }[]).map(u => u.id);
    expect(reverseIds).not.toContain(viewer.id);
  });

  it('block: can be undone via DELETE /users/:id/block', async () => {
    const a = await register(app);
    const b = await register(app);
    createdIds.push(a.id, b.id);

    await request(app).post(`/api/users/${b.id}/block`).set('Authorization', `Bearer ${a.token}`);

    const listBefore = await request(app)
      .get('/api/users/me/blocked')
      .set('Authorization', `Bearer ${a.token}`);
    expect(listBefore.body.data.map((u: { id: string }) => u.id)).toContain(b.id);

    const unblock = await request(app)
      .delete(`/api/users/${b.id}/block`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(unblock.status).toBe(200);
    expect(unblock.body.data.unblocked).toBe(true);

    const listAfter = await request(app)
      .get('/api/users/me/blocked')
      .set('Authorization', `Bearer ${a.token}`);
    expect(listAfter.body.data.map((u: { id: string }) => u.id)).not.toContain(b.id);
  });

  it('block: self-block is rejected (USER_004)', async () => {
    const a = await register(app);
    createdIds.push(a.id);
    const res = await request(app)
      .post(`/api/users/${a.id}/block`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_004');
  });

  it('report: creates a moderation row; rejects invalid reason', async () => {
    const reporter = await register(app);
    const bad = await register(app);
    createdIds.push(reporter.id, bad.id);

    const ok = await request(app)
      .post(`/api/users/${bad.id}/report`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reason: 'harassment', details: 'Repeated abusive DMs' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.reportId).toEqual(expect.any(String));

    const stored = await prisma.report.findUnique({
      where: { id: ok.body.data.reportId },
    });
    expect(stored?.reason).toBe('HARASSMENT');
    expect(stored?.reporterId).toBe(reporter.id);
    expect(stored?.reportedId).toBe(bad.id);

    const invalid = await request(app)
      .post(`/api/users/${bad.id}/report`)
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reason: 'bogus' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_001');
  });
});
