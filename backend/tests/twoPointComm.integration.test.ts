import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server as IoServer } from 'socket.io';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { createSocketServer } =
  require('../src/socket/socket.server') as typeof import('../src/socket/socket.server');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

/**
 * Two-point communication suite — proves a message/action originated by user A
 * reaches user B end-to-end (REST + Socket.IO), entirely in Node: two
 * socket.io-client connections against a real in-memory Socket.IO server, NO
 * device or emulator. Each test uses a fresh A/B pair.
 */
describe('Two-point communication (A ↔ B), no device', () => {
  let app: Express;
  let server: http.Server;
  let io: IoServer;
  let url: string;
  const users: string[] = [];
  const rooms: string[] = [];
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    server = http.createServer(app);
    io = await createSocketServer(server);
    await new Promise<void>(r => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 30_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    for (const id of rooms) await prisma.room.delete({ where: { id } }).catch(() => undefined);
    for (const id of users) await prisma.user.delete({ where: { id } }).catch(() => undefined);
    await new Promise<void>(r => io.close(() => r()));
    await prisma.$disconnect();
    await disconnectRedis();
  });

  type User = { id: string; username: string; token: string };

  const register = async (): Promise<User> => {
    const u = `tp_${rand()}`;
    const r = await request(app)
      .post('/api/auth/register')
      .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
    const user = {
      id: r.body.data.user.id as string,
      username: u,
      token: r.body.data.accessToken as string,
    };
    users.push(user.id);
    return user;
  };

  const pair = async (): Promise<[User, User]> => [await register(), await register()];

  const connect = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const s = ioClient(url, {
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
        forceNew: true,
      });
      sockets.push(s);
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });

  const waitFor = <T = unknown>(s: ClientSocket, event: string, timeout = 6000): Promise<T> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
      s.once(event, (p: T) => {
        clearTimeout(t);
        resolve(p);
      });
    });

  const joinSocketRoom = (s: ClientSocket, roomId: string): Promise<void> =>
    new Promise((resolve, reject) => {
      s.emit('room:join', { roomId }, (ok: boolean) =>
        ok ? resolve() : reject(new Error('join failed')),
      );
    });

  const liveRoom = async (host: User): Promise<string> => {
    const r = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Comm test' });
    const id = r.body.data.id as string;
    rooms.push(id);
    return id;
  };

  // Host A + listener B, both with sockets joined to the room channel.
  const roomPair = async (): Promise<{
    a: User;
    b: User;
    sa: ClientSocket;
    sb: ClientSocket;
    roomId: string;
  }> => {
    const [a, b] = await pair();
    const roomId = await liveRoom(a);
    await request(app).post(`/api/rooms/${roomId}/join`).set('Authorization', `Bearer ${b.token}`);
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    await joinSocketRoom(sa, roomId);
    await joinSocketRoom(sb, roomId);
    return { a, b, sa, sb, roomId };
  };

  // ───────────────────────── Room real-time A↔B ─────────────────────────

  it('B joins the room → A receives room:user-joined', async () => {
    const [a, b] = await pair();
    const roomId = await liveRoom(a);
    const sa = await connect(a.token);
    await joinSocketRoom(sa, roomId);
    const sb = await connect(b.token);

    const got = waitFor<{ userId: string }>(sa, 'room:user-joined');
    await request(app).post(`/api/rooms/${roomId}/join`).set('Authorization', `Bearer ${b.token}`);
    await joinSocketRoom(sb, roomId);
    expect((await got).userId).toBe(b.id);
  }, 20_000);

  it('A sends a reaction (REST) → B receives room:reaction', async () => {
    const { a, sb, roomId } = await roomPair();
    const got = waitFor<{ emoji: string; userId: string }>(sb, 'room:reaction');
    await request(app)
      .post(`/api/rooms/${roomId}/reactions`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ emoji: '🔥' });
    const ev = await got;
    expect(ev.emoji).toBe('🔥');
    expect(ev.userId).toBe(a.id);
  }, 20_000);

  it('A sends a room chat message (REST) → B receives room:chat_message', async () => {
    const { a, sb, roomId } = await roomPair();
    const got = waitFor<{ content: string }>(sb, 'room:chat_message');
    await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ content: 'hello B' });
    expect((await got).content).toBe('hello B');
  }, 20_000);

  it('B raises their hand (REST) → A (host) receives room:hand_raised', async () => {
    const { b, sa, roomId } = await roomPair();
    const got = waitFor<{ roomId: string; user: { id: string } }>(sa, 'room:hand_raised');
    await request(app)
      .post(`/api/rooms/${roomId}/raise-hand`)
      .set('Authorization', `Bearer ${b.token}`);
    expect((await got).user.id).toBe(b.id);
  }, 20_000);

  it('A mutes B (REST) → B receives room:mute-changed (isMuted true)', async () => {
    const { a, b, sb, roomId } = await roomPair();
    const got = waitFor<{ userId: string; isMuted: boolean }>(sb, 'room:mute-changed');
    await request(app)
      .patch(`/api/rooms/${roomId}/mute`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ isMuted: true, userId: b.id });
    const ev = await got;
    expect(ev.userId).toBe(b.id);
    expect(ev.isMuted).toBe(true);
  }, 20_000);

  it('A promotes B to SPEAKER (REST) → B receives room:role_changed', async () => {
    const { a, b, sb, roomId } = await roomPair();
    const got = waitFor<{ userId: string; role: string }>(sb, 'room:role_changed');
    await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ userId: b.id, role: 'SPEAKER' });
    expect((await got).userId).toBe(b.id);
  }, 20_000);

  it('A kicks B (REST) → B receives room:you_were_kicked', async () => {
    const { a, b, sb, roomId } = await roomPair();
    const got = waitFor<{ roomId: string }>(sb, 'room:you_were_kicked');
    await request(app)
      .post(`/api/rooms/${roomId}/kick`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ userId: b.id, banMinutes: 30 });
    expect((await got).roomId).toBe(roomId);
  }, 20_000);

  // ───────────────────────────── DM A↔B ─────────────────────────────────

  it('A sends a 1:1 DM (REST, mutual follow) → B receives chat:message', async () => {
    const [a, b] = await pair();
    // DM requires mutual follow (CHAT_004) — seed both edges directly.
    await prisma.follow.createMany({
      data: [
        { followerId: a.id, followingId: b.id },
        { followerId: b.id, followingId: a.id },
      ],
      skipDuplicates: true,
    });
    await connect(a.token);
    const sb = await connect(b.token);
    const got = waitFor<{ content: string | null }>(sb, 'chat:message');
    await request(app)
      .post(`/api/chat/${b.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ content: 'salut B' });
    expect((await got).content).toBe('salut B');
  }, 20_000);

  it('A emits chat:typing (socket) → B receives chat:typing', async () => {
    const [a, b] = await pair();
    const sa = await connect(a.token);
    const sb = await connect(b.token);
    const got = waitFor<{ senderId: string }>(sb, 'chat:typing');
    sa.emit('chat:typing', { receiverId: b.id });
    expect((await got).senderId).toBe(a.id);
  }, 20_000);

  // ─────────────────────── Social + presence A↔B ───────────────────────

  it('A follows B (REST) → B receives user:follower_count', async () => {
    const [a, b] = await pair();
    await connect(a.token);
    const sb = await connect(b.token);
    const got = waitFor<{ userId: string; count: number }>(sb, 'user:follower_count');
    await request(app).post(`/api/follow/${b.id}`).set('Authorization', `Bearer ${a.token}`);
    const ev = await got;
    expect(ev.userId).toBe(b.id);
    expect(ev.count).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('A emits presence_update (socket heartbeat) → A.lastSeenAt is refreshed', async () => {
    const a = await register();
    const sa = await connect(a.token);
    // Force a stale state, then heartbeat should bring it back to "now"/online.
    const old = new Date('2020-01-01T00:00:00.000Z');
    await prisma.user.update({ where: { id: a.id }, data: { isOnline: false, lastSeenAt: old } });
    sa.emit('presence_update', { at: Date.now() });
    // Poll briefly for the async write.
    let after: { isOnline: boolean; lastSeenAt: Date | null } | null = null;
    for (let i = 0; i < 20; i++) {
      after = await prisma.user.findUnique({
        where: { id: a.id },
        select: { isOnline: true, lastSeenAt: true },
      });
      if (after && after.isOnline && (after.lastSeenAt?.getTime() ?? 0) > old.getTime()) break;
      await new Promise(r => setTimeout(r, 100));
    }
    expect(after?.isOnline).toBe(true);
    expect(after?.lastSeenAt?.getTime() ?? 0).toBeGreaterThan(old.getTime());
  }, 20_000);

  // ───────────────────────────── Hallway A↔B ───────────────────────────

  it('A creates a room (REST) → B (in hallway) receives hallway:room_created', async () => {
    const [a, b] = await pair();
    const sb = await connect(b.token);
    // hallway.handler auto-joins every socket to the hallway channel on connect.
    const got = waitFor<{ room?: { id: string }; id?: string }>(sb, 'hallway:room_created');
    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ title: 'Fresh live room' });
    rooms.push(created.body.data.id);
    const ev = await got;
    const evId = ev.room?.id ?? ev.id;
    expect(evId).toBe(created.body.data.id);
  }, 20_000);
});
