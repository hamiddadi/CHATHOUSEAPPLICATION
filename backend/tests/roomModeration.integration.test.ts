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
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

type User = { id: string; token: string };

/**
 * End-to-end coverage for the in-room moderation surface that had ZERO tests
 * before: ping (the broken-alias regression), mute-all, room invite, REST kick,
 * and per-type room creation gating. Every action is checked from the REST
 * boundary (supertest → real app → Postgres) so an FE/BE contract drift — like
 * the ping route mismatch — fails the build.
 */
describe('Room moderation — ping / mute / mute-all / invite / kick / room types', () => {
  let app: Express;
  const users: string[] = [];
  const rooms: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  }, 30_000);

  afterAll(async () => {
    for (const id of rooms) await prisma.room.delete({ where: { id } }).catch(() => undefined);
    for (const id of users) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
    await disconnectRedis();
  });

  const register = async (): Promise<User> => {
    const u = `rmod_${rand()}`;
    const r = await request(app)
      .post('/api/auth/register')
      .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
    if (!r.body?.data?.user) {
      throw new Error(`register failed: status=${r.status} body=${JSON.stringify(r.body)}`);
    }
    const user = { id: r.body.data.user.id as string, token: r.body.data.accessToken as string };
    users.push(user.id);
    return user;
  };

  const createRoom = async (host: User, body: Record<string, unknown> = {}): Promise<string> => {
    const r = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Mod test', ...body });
    expect(r.status).toBe(201);
    const id = r.body.data.id as string;
    rooms.push(id);
    return id;
  };

  const join = (u: User, roomId: string) =>
    request(app).post(`/api/rooms/${roomId}/join`).set('Authorization', `Bearer ${u.token}`);

  const setRole = (caller: User, roomId: string, userId: string, role: string) =>
    request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${caller.token}`)
      .send({ userId, role });

  const participant = (roomId: string, userId: string) =>
    prisma.participant.findUnique({ where: { userId_roomId: { userId, roomId } } });

  // ─────────────────────────────── PING ────────────────────────────────
  describe('ping (POST /rooms/:id/ping/:userId)', () => {
    it('an active participant pings another user → 200 + a ROOM_INVITE notification', async () => {
      const host = await register();
      const listener = await register();
      const roomId = await createRoom(host);
      await join(listener, roomId);

      const res = await request(app)
        .post(`/api/rooms/${roomId}/ping/${host.id}`)
        .set('Authorization', `Bearer ${listener.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.pinged).toBe(true);

      const notifs = await prisma.notification.count({
        where: { userId: host.id, type: 'ROOM_INVITE' },
      });
      expect(notifs).toBeGreaterThanOrEqual(1);
    });

    it('self-ping is rejected → USER_003', async () => {
      const host = await register();
      const roomId = await createRoom(host);
      const res = await request(app)
        .post(`/api/rooms/${roomId}/ping/${host.id}`)
        .set('Authorization', `Bearer ${host.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('USER_003');
    });

    it('a non-participant cannot ping → ROOM_005', async () => {
      const host = await register();
      const stranger = await register();
      const roomId = await createRoom(host);
      const res = await request(app)
        .post(`/api/rooms/${roomId}/ping/${host.id}`)
        .set('Authorization', `Bearer ${stranger.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROOM_005');
    });

    it('ping is blocked in a private room → ROOM_007', async () => {
      const host = await register();
      const target = await register();
      const roomId = await createRoom(host, { isPrivate: true, roomType: 'CLOSED' });
      const res = await request(app)
        .post(`/api/rooms/${roomId}/ping/${target.id}`)
        .set('Authorization', `Bearer ${host.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROOM_007');
    });

    it('REGRESSION: the /users/:id/ping alias is gone — FE must use the room-scoped route', async () => {
      const host = await register();
      const listener = await register();
      const roomId = await createRoom(host);
      await join(listener, roomId);

      // The old /users/:userId/ping alias (which the FE wrongly POSTed roomId to
      // in the body) was removed. It was wired to the shared ping controller,
      // which reads roomId from params.id — a param that route never provided,
      // so it always 404'd. Hitting the dead path must now fall through to the
      // catch-all 404 handler (NOT_FOUND_001), never to a working ping.
      const res = await request(app)
        .post(`/api/users/${host.id}/ping`)
        .set('Authorization', `Bearer ${listener.token}`)
        .send({ roomId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND_001');
    });
  });

  // ─────────────────────────── MUTE (single) ───────────────────────────
  describe('mute / unmute a single person (PATCH /rooms/:id/mute)', () => {
    it('host mutes then unmutes a speaker', async () => {
      const host = await register();
      const speaker = await register();
      const roomId = await createRoom(host);
      await join(speaker, roomId);
      await setRole(host, roomId, speaker.id, 'SPEAKER');

      const mute = await request(app)
        .patch(`/api/rooms/${roomId}/mute`)
        .set('Authorization', `Bearer ${host.token}`)
        .send({ isMuted: true, userId: speaker.id });
      expect(mute.status).toBe(200);
      expect((await participant(roomId, speaker.id))?.isMuted).toBe(true);

      const unmute = await request(app)
        .patch(`/api/rooms/${roomId}/mute`)
        .set('Authorization', `Bearer ${host.token}`)
        .send({ isMuted: false, userId: speaker.id });
      expect(unmute.status).toBe(200);
      expect((await participant(roomId, speaker.id))?.isMuted).toBe(false);
    });

    it('a plain listener cannot mute someone else → ROOM_003', async () => {
      const host = await register();
      const speaker = await register();
      const listener = await register();
      const roomId = await createRoom(host);
      await join(speaker, roomId);
      await join(listener, roomId);
      await setRole(host, roomId, speaker.id, 'SPEAKER');

      const res = await request(app)
        .patch(`/api/rooms/${roomId}/mute`)
        .set('Authorization', `Bearer ${listener.token}`)
        .send({ isMuted: true, userId: speaker.id });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROOM_003');
    });

    it('a moderator cannot mute the host → ROOM_009', async () => {
      const host = await register();
      const mod = await register();
      const roomId = await createRoom(host);
      await join(mod, roomId);
      await setRole(host, roomId, mod.id, 'MODERATOR');

      const res = await request(app)
        .patch(`/api/rooms/${roomId}/mute`)
        .set('Authorization', `Bearer ${mod.token}`)
        .send({ isMuted: true, userId: host.id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ROOM_009');
    });
  });

  // ───────────────────────────── MUTE ALL ──────────────────────────────
  describe('mute all (POST /rooms/:id/mute-all)', () => {
    it('host mutes every speaker but not themselves (includeHost defaults false)', async () => {
      const host = await register();
      const speaker = await register();
      const roomId = await createRoom(host);
      await join(speaker, roomId);
      await setRole(host, roomId, speaker.id, 'SPEAKER');

      const res = await request(app)
        .post(`/api/rooms/${roomId}/mute-all`)
        .set('Authorization', `Bearer ${host.token}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.mutedCount).toBeGreaterThanOrEqual(1);
      expect((await participant(roomId, speaker.id))?.isMuted).toBe(true);
      expect((await participant(roomId, host.id))?.isMuted).toBe(false);
    });

    it('a non-moderator cannot mute all → ROOM_003', async () => {
      const host = await register();
      const listener = await register();
      const roomId = await createRoom(host);
      await join(listener, roomId);

      const res = await request(app)
        .post(`/api/rooms/${roomId}/mute-all`)
        .set('Authorization', `Bearer ${listener.token}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROOM_003');
    });
  });

  // ──────────────────────── INVITE (add a person) ──────────────────────
  describe('invite to room (POST /rooms/:id/invite)', () => {
    it('a participant invites a user to a public room → notification created', async () => {
      const host = await register();
      const invitee = await register();
      const roomId = await createRoom(host);

      const res = await request(app)
        .post(`/api/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${host.token}`)
        .send({ userIds: [invitee.id] });
      expect(res.status).toBe(200);
      expect(res.body.data.invitedCount).toBe(1);

      const notifs = await prisma.notification.count({
        where: { userId: invitee.id, type: 'ROOM_INVITE' },
      });
      expect(notifs).toBeGreaterThanOrEqual(1);
    });

    it('private room: a non-invitee is rejected, then can join once invited', async () => {
      const host = await register();
      const guest = await register();
      const roomId = await createRoom(host, { isPrivate: true, roomType: 'CLOSED' });

      const blocked = await join(guest, roomId);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('ROOM_007');

      const invite = await request(app)
        .post(`/api/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${host.token}`)
        .send({ userIds: [guest.id] });
      expect(invite.status).toBe(200);

      const allowed = await join(guest, roomId);
      expect(allowed.status).toBe(200);
    });

    it('private room: a pre-seated listener cannot invite (host/mod only) → ROOM_003', async () => {
      const host = await register();
      const guest = await register();
      const outsider = await register();
      const roomId = await createRoom(host, { isPrivate: true, roomType: 'CLOSED' });

      await request(app)
        .post(`/api/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${host.token}`)
        .send({ userIds: [guest.id] });
      await join(guest, roomId);

      const res = await request(app)
        .post(`/api/rooms/${roomId}/invite`)
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ userIds: [outsider.id] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROOM_003');
    });
  });

  // ─────────────────────────────── KICK ────────────────────────────────
  describe('kick (POST /rooms/:id/kick)', () => {
    it('host kicks a listener → leaves the room and is banned from rejoining (ROOM_008)', async () => {
      const host = await register();
      const listener = await register();
      const roomId = await createRoom(host);
      await join(listener, roomId);

      const res = await request(app)
        .post(`/api/rooms/${roomId}/kick`)
        .set('Authorization', `Bearer ${host.token}`)
        .send({ userId: listener.id, banMinutes: 30 });
      expect(res.status).toBe(200);
      expect(res.body.data.kicked).toBe(true);
      expect((await participant(roomId, listener.id))?.leftAt).not.toBeNull();

      const rejoin = await join(listener, roomId);
      expect(rejoin.status).toBe(403);
      expect(rejoin.body.error.code).toBe('ROOM_008');
    });

    it('cannot kick the host → ROOM_003', async () => {
      const host = await register();
      const mod = await register();
      const roomId = await createRoom(host);
      await join(mod, roomId);
      await setRole(host, roomId, mod.id, 'MODERATOR');

      const res = await request(app)
        .post(`/api/rooms/${roomId}/kick`)
        .set('Authorization', `Bearer ${mod.token}`)
        .send({ userId: host.id });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROOM_003');
    });

    it('cannot kick yourself → USER_003 (a moderator self-kick; the host hits ROOM_003 first)', async () => {
      const host = await register();
      const mod = await register();
      const roomId = await createRoom(host);
      await join(mod, roomId);
      await setRole(host, roomId, mod.id, 'MODERATOR');

      const res = await request(app)
        .post(`/api/rooms/${roomId}/kick`)
        .set('Authorization', `Bearer ${mod.token}`)
        .send({ userId: mod.id });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('USER_003');
    });

    it('a plain listener cannot kick → ROOM_003', async () => {
      const host = await register();
      const a = await register();
      const b = await register();
      const roomId = await createRoom(host);
      await join(a, roomId);
      await join(b, roomId);

      const res = await request(app)
        .post(`/api/rooms/${roomId}/kick`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ userId: b.id });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ROOM_003');
    });
  });

  // ───────────────────── CREATE: the 3 room types ──────────────────────
  describe('room types persist + gate joins correctly', () => {
    it('OPEN room: anyone can join', async () => {
      const host = await register();
      const stranger = await register();
      const roomId = await createRoom(host, { roomType: 'OPEN' });

      const get = await request(app)
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${host.token}`);
      expect(get.body.data.roomType).toBe('OPEN');
      expect(get.body.data.isPrivate).toBe(false);

      expect((await join(stranger, roomId)).status).toBe(200);
    });

    it('SOCIAL room: only followers of the host can join (ROOM_007 otherwise)', async () => {
      const host = await register();
      const follower = await register();
      const stranger = await register();
      const roomId = await createRoom(host, { roomType: 'SOCIAL' });

      const get = await request(app)
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${host.token}`);
      expect(get.body.data.roomType).toBe('SOCIAL');
      expect(get.body.data.isPrivate).toBe(false);

      const blocked = await join(stranger, roomId);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('ROOM_007');

      // Seed the follow edge so the follow-gate lets the follower in.
      await prisma.follow.create({
        data: { followerId: follower.id, followingId: host.id },
      });
      expect((await join(follower, roomId)).status).toBe(200);
    });

    it('CLOSED room: persisted as private + invite-only (ROOM_007 for outsiders)', async () => {
      const host = await register();
      const stranger = await register();
      const roomId = await createRoom(host, { isPrivate: true, roomType: 'CLOSED' });

      const get = await request(app)
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${host.token}`);
      expect(get.body.data.roomType).toBe('CLOSED');
      expect(get.body.data.isPrivate).toBe(true);

      const blocked = await join(stranger, roomId);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('ROOM_007');
    });
  });
});
