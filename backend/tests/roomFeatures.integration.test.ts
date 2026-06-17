import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { mountExtensions } =
  require('../src/extensions/mount') as typeof import('../src/extensions/mount');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

type User = { id: string; token: string };

/**
 * Room lifecycle / moderation feature checks — each maps 1:1 to a requested
 * functionality. REST boundary against the real app + Postgres/Redis.
 */
describe('Room features — roles, moderation, lifecycle', () => {
  let app: Express;
  const users: string[] = [];
  const rooms: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    // `createApp()` builds the legacy surface only; the `/api/ext/*` extension
    // routers are mounted by bootstrap() (gated by EXTENSIONS_ENABLED, default
    // true). Mirror that here so the extension endpoints this suite exercises
    // (hand-raise restriction settings) are reachable, exactly as in prod.
    mountExtensions(app);
  }, 30_000);

  afterAll(async () => {
    for (const id of rooms) await prisma.room.delete({ where: { id } }).catch(() => undefined);
    for (const id of users) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    await prisma.$disconnect();
    await disconnectRedis();
  });

  const register = async (): Promise<User> => {
    const u = `rf_${rand()}`;
    const r = await request(app)
      .post('/api/auth/register')
      .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
    const user = { id: r.body.data.user.id as string, token: r.body.data.accessToken as string };
    users.push(user.id);
    return user;
  };

  const liveRoom = async (host: User, body: Record<string, unknown> = {}): Promise<string> => {
    const r = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Feature test', ...body });
    const id = r.body.data.id as string;
    rooms.push(id);
    return id;
  };

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const role = async (roomId: string, t: string, userId: string) => {
    const room = await prisma.participant.findUnique({
      where: { userId_roomId: { userId, roomId } },
      select: { role: true },
    });
    void t;
    return room?.role;
  };

  // 1 — join → default LISTENER role
  it('1. A user joins a room → assigned LISTENER role by default', async () => {
    const host = await register();
    const b = await register();
    const roomId = await liveRoom(host);
    const res = await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));
    expect(res.status).toBe(200);
    expect(await role(roomId, b.token, b.id)).toBe('LISTENER');
  });

  // 2 — listener raises hand → surfaced to moderators (queue)
  it('2. A listener raises their hand → request reaches moderators (hand-raise queue)', async () => {
    const host = await register();
    const b = await register();
    const roomId = await liveRoom(host);
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));
    await request(app).post(`/api/rooms/${roomId}/raise-hand`).set(auth(b.token));
    const q = await request(app).get(`/api/rooms/${roomId}/hand-raises`).set(auth(host.token));
    expect(q.status).toBe(200);
    expect(q.body.data.some((u: { id: string }) => u.id === b.id)).toBe(true);
  });

  // 3 + 4 — moderator ACCEPTS the request (promote) → speaker + hand cleared
  it('3/4. A moderator accepts the speak request → listener promoted to SPEAKER, hand cleared', async () => {
    const host = await register();
    const b = await register();
    const roomId = await liveRoom(host);
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));
    await request(app).post(`/api/rooms/${roomId}/raise-hand`).set(auth(b.token));
    const promote = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set(auth(host.token))
      .send({ userId: b.id, role: 'SPEAKER' });
    expect(promote.status).toBe(200);
    expect(await role(roomId, host.token, b.id)).toBe('SPEAKER');
    const q = await request(app).get(`/api/rooms/${roomId}/hand-raises`).set(auth(host.token));
    expect(q.body.data.some((u: { id: string }) => u.id === b.id)).toBe(false);
  });

  // 3b — moderator REFUSES (dismisses) a pending speak request
  it('3b. A moderator refuses a speak request → removed from the queue', async () => {
    const host = await register();
    const b = await register();
    const roomId = await liveRoom(host);
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));
    await request(app).post(`/api/rooms/${roomId}/raise-hand`).set(auth(b.token));
    const dismiss = await request(app)
      .delete(`/api/rooms/${roomId}/hand-raises/${b.id}`)
      .set(auth(host.token));
    expect(dismiss.status).toBe(200);
    expect(dismiss.body.data.dismissed).toBe(true);
    const q = await request(app).get(`/api/rooms/${roomId}/hand-raises`).set(auth(host.token));
    expect(q.body.data.some((u: { id: string }) => u.id === b.id)).toBe(false);
    // role unchanged — refusing is not promoting
    expect(await role(roomId, host.token, b.id)).toBe('LISTENER');
  });

  // 5 — speaker demoted to listener (manual)
  it('5. A speaker is demoted back to LISTENER (manual)', async () => {
    const host = await register();
    const b = await register();
    const roomId = await liveRoom(host);
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));
    await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set(auth(host.token))
      .send({ userId: b.id, role: 'SPEAKER' });
    const demote = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set(auth(host.token))
      .send({ userId: b.id, role: 'LISTENER' });
    expect(demote.status).toBe(200);
    expect(await role(roomId, host.token, b.id)).toBe('LISTENER');
  });

  // 6 — participant banned/kicked from the room
  it('6. A participant is banned/kicked → leaves + cannot rejoin (ROOM_008)', async () => {
    const host = await register();
    const b = await register();
    const roomId = await liveRoom(host);
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));
    const kick = await request(app)
      .post(`/api/rooms/${roomId}/kick`)
      .set(auth(host.token))
      .send({ userId: b.id, banMinutes: 30 });
    expect(kick.status).toBe(200);
    const rejoin = await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error.code).toBe('ROOM_008');
  });

  // 7 — user pinged (invited) to the room by a moderator
  it('7. A user is pinged (invited) into the room → ROOM_INVITE notification created', async () => {
    const host = await register();
    const target = await register();
    const roomId = await liveRoom(host);
    const res = await request(app)
      .post(`/api/rooms/${roomId}/ping/${target.id}`)
      .set(auth(host.token));
    expect(res.status).toBe(200);
    expect(res.body.data.pinged).toBe(true);
    const n = await prisma.notification.count({
      where: { userId: target.id, type: 'ROOM_INVITE' },
    });
    expect(n).toBeGreaterThanOrEqual(1);
  });

  // 8 — moderator toggles the "raise hand" feature on/off
  it('8. A moderator disables then enables "raise hand" → enforced', async () => {
    const host = await register();
    const b = await register();
    const roomId = await liveRoom(host);
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));

    // disable
    const patch = await request(app)
      .patch(`/api/ext/room-settings/${roomId}/hand-raise`)
      .set(auth(host.token))
      .send({ restriction: 'none' });
    expect(patch.status).toBe(200);
    const blocked = await request(app).post(`/api/rooms/${roomId}/raise-hand`).set(auth(b.token));
    expect(blocked.status).toBe(403);

    // re-enable
    await request(app)
      .patch(`/api/ext/room-settings/${roomId}/hand-raise`)
      .set(auth(host.token))
      .send({ restriction: 'everyone' });
    const ok = await request(app).post(`/api/rooms/${roomId}/raise-hand`).set(auth(b.token));
    expect(ok.status).toBe(200);
  });

  // 9 — a speaker is promoted to MODERATOR
  it('9. A speaker is promoted to MODERATOR', async () => {
    const host = await register();
    const b = await register();
    const roomId = await liveRoom(host);
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));
    await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set(auth(host.token))
      .send({ userId: b.id, role: 'SPEAKER' });
    const mod = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set(auth(host.token))
      .send({ userId: b.id, role: 'MODERATOR' });
    expect(mod.status).toBe(200);
    expect(await role(roomId, host.token, b.id)).toBe('MODERATOR');
  });

  // 10 — system (admin) security-style notification: ROOM_ENDED_BY_ADMIN
  it('10. System notification — admin force-ends a room → participant gets ROOM_ENDED_BY_ADMIN', async () => {
    const host = await register();
    const b = await register();
    const admin = await register();
    await prisma.user.update({ where: { id: admin.id }, data: { appRole: 'ADMIN' } });
    const roomId = await liveRoom(host);
    await request(app).post(`/api/rooms/${roomId}/join`).set(auth(b.token));

    const res = await request(app)
      .post(`/api/admin/rooms/${roomId}/force-end`)
      .set(auth(admin.token))
      .send({ reason: 'policy' });
    expect([200, 201]).toContain(res.status);
    const n = await prisma.notification.count({
      where: { userId: b.id, type: 'ROOM_ENDED_BY_ADMIN' },
    });
    expect(n).toBeGreaterThanOrEqual(1);
  });

  // 12 — room flagged for replay recording
  it('12. A room is flagged for replay recording (recordingEnabled persisted)', async () => {
    const host = await register();
    const roomId = await liveRoom(host, { recordingEnabled: true });
    const res = await request(app).get(`/api/rooms/${roomId}`).set(auth(host.token));
    expect(res.status).toBe(200);
    expect(res.body.data.recordingEnabled).toBe(true);
  });

  // 13 — room ended by a moderator (End Room)
  it('13. A room is ended by the host (End Room) → endedAt set', async () => {
    const host = await register();
    const roomId = await liveRoom(host);
    const res = await request(app).post(`/api/rooms/${roomId}/end`).set(auth(host.token));
    expect(res.status).toBe(200);
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { endedAt: true } });
    expect(room?.endedAt).not.toBeNull();
  });

  // 14 — room flipped private↔public after creation (host only)
  it('14. A room is flipped private↔public after creation (host only)', async () => {
    const host = await register();
    const stranger = await register();
    const roomId = await liveRoom(host);
    // public by default
    let res = await request(app).get(`/api/rooms/${roomId}`).set(auth(host.token));
    expect(res.body.data.isPrivate).toBe(false);
    // public → private
    const toPriv = await request(app)
      .patch(`/api/rooms/${roomId}/privacy`)
      .set(auth(host.token))
      .send({ isPrivate: true });
    expect(toPriv.status).toBe(200);
    expect(toPriv.body.data.isPrivate).toBe(true);
    res = await request(app).get(`/api/rooms/${roomId}`).set(auth(host.token));
    expect(res.body.data.isPrivate).toBe(true);
    // a non-host cannot flip it (ROOM_003)
    const denied = await request(app)
      .patch(`/api/rooms/${roomId}/privacy`)
      .set(auth(stranger.token))
      .send({ isPrivate: false });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ROOM_003');
    // host flips back → public
    const toPub = await request(app)
      .patch(`/api/rooms/${roomId}/privacy`)
      .set(auth(host.token))
      .send({ isPrivate: false });
    expect(toPub.status).toBe(200);
    expect(toPub.body.data.isPrivate).toBe(false);
  });

  // 15 — scheduled room (countdown) — scheduledFor persisted, not yet live
  it('15. A scheduled room is created with a future start (countdown) → scheduledFor set, not live', async () => {
    const host = await register();
    const scheduledFor = new Date(Date.now() + 3_600_000).toISOString();
    const roomId = await liveRoom(host, { scheduledFor });
    const res = await request(app).get(`/api/rooms/${roomId}`).set(auth(host.token));
    expect(res.status).toBe(200);
    expect(res.body.data.isLive).toBe(false);
    expect(res.body.data.scheduledFor).toBeTruthy();
  });
});
