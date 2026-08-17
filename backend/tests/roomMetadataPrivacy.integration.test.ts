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
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

type TestUser = {
  id: string;
  username: string;
  token: string;
};

describe('Room metadata privacy', () => {
  let app: Express;
  const userIds: string[] = [];
  const roomIds: string[] = [];

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

  const register = async (): Promise<TestUser> => {
    const username = `rmeta_${rand()}`;
    const result = await request(app)
      .post('/api/auth/register')
      .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
    expect(result.status).toBe(201);
    const user = {
      id: result.body.data.user.id as string,
      username,
      token: result.body.data.accessToken as string,
    };
    userIds.push(user.id);
    return user;
  };

  const createRoom = async (
    host: TestUser,
    input: Record<string, unknown>,
  ): Promise<{ id: string; body: Record<string, unknown> }> => {
    const result = await request(app)
      .post('/api/rooms')
      .set(auth(host))
      .send({ title: `Metadata ${rand()}`, ...input });
    expect(result.status).toBe(201);
    const id = result.body.data.id as string;
    roomIds.push(id);
    return { id, body: result.body.data as Record<string, unknown> };
  };

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const roomId of roomIds) {
      await cancelEventReminder(roomId).catch(() => undefined);
    }
    await shutdownReminders();
    await shutdownReminder15();
    for (const roomId of roomIds) {
      await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    }
    for (const userId of userIds) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('hides private metadata across detail, share, calendar, RSVP, and recent history', async () => {
    const host = await register();
    const outsider = await register();
    const privateLive = await createRoom(host, { roomType: 'CLOSED' });
    const privateEvent = await createRoom(host, {
      roomType: 'CLOSED',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    // roomType=CLOSED is canonicalised server-side even when a caller omits
    // the legacy isPrivate flag.
    expect(privateLive.body.isPrivate).toBe(true);

    const detail = await request(app).get(`/api/rooms/${privateLive.id}`).set(auth(outsider));
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe('ROOM_001');

    const share = await request(app)
      .get(`/api/ext/share/rooms/${privateLive.id}`)
      .set(auth(outsider));
    expect(share.status).toBe(404);

    const calendar = await request(app)
      .get(`/api/ext/calendar/${privateEvent.id}.ics`)
      .set(auth(outsider));
    expect(calendar.status).toBe(404);

    const rsvp = await request(app).post(`/api/rooms/${privateEvent.id}/rsvp`).set(auth(outsider));
    expect(rsvp.status).toBe(404);

    const touch = await request(app)
      .post(`/api/ext/recently-played/${privateLive.id}/touch`)
      .set(auth(outsider));
    expect(touch.status).toBe(404);
  });

  it('stores a private invitation as inactive, then activates it only on join', async () => {
    const host = await register();
    const invitee = await register();
    const room = await createRoom(host, { isPrivate: true });

    const invited = await request(app)
      .post(`/api/rooms/${room.id}/invite`)
      .set(auth(host))
      .send({ userIds: [invitee.id] });
    expect(invited.status).toBe(200);
    expect(invited.body.data.invitedCount).toBe(1);

    const beforeJoin = await prisma.participant.findUnique({
      where: { userId_roomId: { userId: invitee.id, roomId: room.id } },
    });
    expect(beforeJoin?.leftAt).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: invitee.id } })).toMatchObject({
      currentRoomId: null,
    });

    const detail = await request(app).get(`/api/rooms/${room.id}`).set(auth(invitee));
    expect(detail.status).toBe(200);
    expect(
      detail.body.data.participants.map((participant: { userId: string }) => participant.userId),
    ).not.toContain(invitee.id);

    const joined = await request(app).post(`/api/rooms/${room.id}/join`).set(auth(invitee));
    expect(joined.status).toBe(200);

    const [afterJoin, persistedRoom, persistedUser] = await Promise.all([
      prisma.participant.findUnique({
        where: { userId_roomId: { userId: invitee.id, roomId: room.id } },
      }),
      prisma.room.findUnique({ where: { id: room.id } }),
      prisma.user.findUnique({ where: { id: invitee.id } }),
    ]);
    expect(afterJoin?.leftAt).toBeNull();
    expect(persistedRoom?.participantCount).toBe(2);
    expect(persistedUser?.currentRoomId).toBe(room.id);
  });

  it('requires an ACCEPTED follow for every SOCIAL-room discovery surface', async () => {
    const host = await register();
    const follower = await register();
    await prisma.user.update({
      where: { id: host.id },
      data: { isPrivateAccount: true },
    });
    const room = await createRoom(host, { roomType: 'SOCIAL' });
    const title = String(room.body.title);

    const pending = await request(app).post(`/api/follow/${host.id}`).set(auth(follower));
    expect(pending.status).toBe(200);
    expect(pending.body.data.requested).toBe(true);

    expect((await request(app).get(`/api/rooms/${room.id}`).set(auth(follower))).status).toBe(404);
    const pendingList = await request(app).get('/api/rooms').set(auth(follower));
    expect(pendingList.body.data.map((item: { id: string }) => item.id)).not.toContain(room.id);
    const pendingSearch = await request(app)
      .get(`/api/search?type=rooms&q=${encodeURIComponent(title)}`)
      .set(auth(follower));
    expect(pendingSearch.body.data.rooms.map((item: { id: string }) => item.id)).not.toContain(
      room.id,
    );
    expect(
      (await request(app).get(`/api/ext/share/rooms/${room.id}`).set(auth(follower))).status,
    ).toBe(404);

    const accepted = await request(app).post(`/api/follow/${follower.id}/accept`).set(auth(host));
    expect(accepted.status).toBe(200);

    expect((await request(app).get(`/api/rooms/${room.id}`).set(auth(follower))).status).toBe(200);
    const acceptedList = await request(app).get('/api/rooms').set(auth(follower));
    expect(acceptedList.body.data.map((item: { id: string }) => item.id)).toContain(room.id);
    const acceptedSearch = await request(app)
      .get(`/api/search?type=rooms&q=${encodeURIComponent(title)}`)
      .set(auth(follower));
    expect(acceptedSearch.body.data.rooms.map((item: { id: string }) => item.id)).toContain(
      room.id,
    );
    expect(
      (await request(app).get(`/api/ext/share/rooms/${room.id}`).set(auth(follower))).status,
    ).toBe(200);

    expect((await request(app).post(`/api/rooms/${room.id}/join`).set(auth(follower))).status).toBe(
      200,
    );
    expect(
      (await request(app).post(`/api/rooms/${room.id}/leave`).set(auth(follower))).status,
    ).toBe(200);
    expect((await request(app).delete(`/api/follow/${host.id}`).set(auth(follower))).status).toBe(
      200,
    );
    // A historical Participant row must not replace current follow approval.
    expect((await request(app).get(`/api/rooms/${room.id}`).set(auth(follower))).status).toBe(404);
    expect((await request(app).post(`/api/rooms/${room.id}/join`).set(auth(follower))).status).toBe(
      403,
    );

    const blocked = await request(app).post(`/api/users/${follower.id}/block`).set(auth(host));
    expect(blocked.status).toBe(200);
    expect((await request(app).get(`/api/rooms/${room.id}`).set(auth(follower))).status).toBe(404);
    expect((await request(app).post(`/api/rooms/${room.id}/join`).set(auth(follower))).status).toBe(
      403,
    );
  });

  it('denies private-room metadata while a participant has an active room ban', async () => {
    const host = await register();
    const invitee = await register();
    const room = await createRoom(host, { roomType: 'CLOSED' });

    await request(app)
      .post(`/api/rooms/${room.id}/invite`)
      .set(auth(host))
      .send({ userIds: [invitee.id] });
    await request(app).post(`/api/rooms/${room.id}/join`).set(auth(invitee));

    const kicked = await request(app)
      .post(`/api/rooms/${room.id}/kick`)
      .set(auth(host))
      .send({ userId: invitee.id, banMinutes: 30 });
    expect(kicked.status).toBe(200);
    expect((await request(app).get(`/api/rooms/${room.id}`).set(auth(invitee))).status).toBe(404);
  });
});
