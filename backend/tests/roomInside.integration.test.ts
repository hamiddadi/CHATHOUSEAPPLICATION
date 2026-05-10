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

const register = async (app: Express) => {
  const u = `rin_${rand()}`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: r.body.data.user.id as string, token: r.body.data.accessToken as string };
};

describe('Inside-a-room — hand raise + chat + reactions', () => {
  let app: Express;
  let server: http.Server;
  let io: IoServer;
  let url: string;
  const createdUsers: string[] = [];
  const createdRooms: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    server = http.createServer(app);
    io = await createSocketServer(server);
    await new Promise<void>(r => server.listen(0, r));
    const addr = server.address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}`;
  }, 30_000);

  afterAll(async () => {
    for (const id of createdRooms) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUsers) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await new Promise<void>(r => io.close(() => r()));
    await prisma.$disconnect();
    await disconnectRedis();
  });

  const connect = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const s = ioClient(url, {
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
        forceNew: true,
      });
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });

  const joinSocketRoom = (sock: ClientSocket, roomId: string): Promise<void> =>
    new Promise((resolve, reject) => {
      sock.emit('room:join', { roomId }, (ok: boolean) => {
        if (ok) resolve();
        else reject(new Error('room:join failed'));
      });
    });

  const hostWithRoom = async (): Promise<{
    host: { id: string; token: string };
    listener: { id: string; token: string };
    roomId: string;
  }> => {
    const host = await register(app);
    const listener = await register(app);
    createdUsers.push(host.id, listener.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Inside test' });
    const roomId = created.body.data.id as string;
    createdRooms.push(roomId);

    // listener joins the room
    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${listener.token}`);

    return { host, listener, roomId };
  };

  it('raise/lower hand: queue ordering + participant guard (ROOM_005)', async () => {
    const { host, listener, roomId } = await hostWithRoom();

    // Stranger (not in room) cannot raise their hand → 403 ROOM_005
    const stranger = await register(app);
    createdUsers.push(stranger.id);
    const strangerRaise = await request(app)
      .post(`/api/rooms/${roomId}/raise-hand`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(strangerRaise.status).toBe(403);
    expect(strangerRaise.body.error.code).toBe('ROOM_005');

    // Listener raises — ok.
    const raise = await request(app)
      .post(`/api/rooms/${roomId}/raise-hand`)
      .set('Authorization', `Bearer ${listener.token}`);
    expect(raise.status).toBe(200);
    expect(raise.body.data.raised).toBe(true);

    // Host can list the queue.
    const queue = await request(app)
      .get(`/api/rooms/${roomId}/hand-raises`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(queue.status).toBe(200);
    expect(queue.body.data).toHaveLength(1);
    expect(queue.body.data[0].id).toBe(listener.id);

    // Idempotent re-raise.
    const dup = await request(app)
      .post(`/api/rooms/${roomId}/raise-hand`)
      .set('Authorization', `Bearer ${listener.token}`);
    expect(dup.status).toBe(200);
    const queueAgain = await request(app)
      .get(`/api/rooms/${roomId}/hand-raises`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(queueAgain.body.data).toHaveLength(1);

    // Host promotes to SPEAKER → hand row cleared.
    const promote = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ userId: listener.id, role: 'SPEAKER' });
    expect(promote.status).toBe(200);
    const afterPromote = await request(app)
      .get(`/api/rooms/${roomId}/hand-raises`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(afterPromote.body.data).toHaveLength(0);
  });

  it('chat: send + list + chatEnabled=false blocks (ROOM_006)', async () => {
    const { host, listener, roomId } = await hostWithRoom();

    const send = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${listener.token}`)
      .send({ content: 'Hey everyone 👋' });
    expect(send.status).toBe(201);
    expect(send.body.data.content).toBe('Hey everyone 👋');

    const list = await request(app)
      .get(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((m: { content: string }) => m.content)).toContain('Hey everyone 👋');

    // Disable chat on a fresh room via the schema default → create with chatEnabled=false.
    const noChat = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'No chat room', chatEnabled: false });
    const noChatId = noChat.body.data.id as string;
    createdRooms.push(noChatId);
    // host is auto-participant; sending should still be blocked.
    const blocked = await request(app)
      .post(`/api/rooms/${noChatId}/messages`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ content: 'should fail' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ROOM_006');
  });

  it('reactions: POST then socket broadcast reaches listeners in the room', async () => {
    const { host, listener, roomId } = await hostWithRoom();

    const hostSock = await connect(host.token);
    const listenerSock = await connect(listener.token);

    // Both sockets must explicitly join the room channel — we rely on the
    // existing `room:join` handler to wire the `room:<id>` group.
    await joinSocketRoom(hostSock, roomId);
    await joinSocketRoom(listenerSock, roomId);

    const received = new Promise<{ emoji: string; userId: string }>(resolve => {
      hostSock.once('room:reaction', resolve);
    });

    await request(app)
      .post(`/api/rooms/${roomId}/reactions`)
      .set('Authorization', `Bearer ${listener.token}`)
      .send({ emoji: '🎉' });

    const event = await received;
    expect(event.emoji).toBe('🎉');
    expect(event.userId).toBe(listener.id);

    hostSock.disconnect();
    listenerSock.disconnect();
  }, 20_000);

  it('chat message: socket broadcast mirrors the REST POST', async () => {
    const { host, listener, roomId } = await hostWithRoom();

    const hostSock = await connect(host.token);
    const listenerSock = await connect(listener.token);
    await joinSocketRoom(hostSock, roomId);
    await joinSocketRoom(listenerSock, roomId);

    const received = new Promise<{ content: string }>(resolve => {
      hostSock.once('room:chat_message', resolve);
    });

    await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${listener.token}`)
      .send({ content: 'via socket please' });

    const msg = await received;
    expect(msg.content).toBe('via socket please');

    hostSock.disconnect();
    listenerSock.disconnect();
  }, 20_000);
});
