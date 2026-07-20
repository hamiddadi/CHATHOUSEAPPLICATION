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
  const username = `dc_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
  };
};

const eventually = async (assertion: () => Promise<void>, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  throw lastError;
};

describe('Socket disconnect → room participation cleanup', () => {
  let app: Express;
  let server: http.Server;
  let io: IoServer;
  let url: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    server = http.createServer(app);
    io = await createSocketServer(server);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}`;
  }, 30_000);

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await new Promise<void>(resolve => io.close(() => resolve()));
    await prisma.$disconnect();
    await disconnectRedis();
  });

  const connectWith = (token: string): Promise<ClientSocket> =>
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

  const joinRoom = (sock: ClientSocket, roomId: string): Promise<void> =>
    new Promise(resolve => sock.emit('room:join', { roomId }, () => resolve()));

  it('an ungraceful disconnect leaves the room (room:user-left + leftAt set)', async () => {
    const host = await register(app);
    const listener = await register(app);
    createdIds.push(host.id, listener.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Disconnect cleanup test room' });
    const roomId = created.body.data.id as string;
    expect(roomId).toBeTruthy();

    const hostSock = await connectWith(host.token);
    const listenerSock = await connectWith(listener.token);
    await joinRoom(hostSock, roomId);
    await joinRoom(listenerSock, roomId);

    // The participant row exists and is active before the drop.
    const before = await prisma.participant.findUnique({
      where: { userId_roomId: { userId: listener.id, roomId } },
    });
    expect(before?.leftAt).toBeNull();

    // The host (still in the channel) should be told the listener left when the
    // listener's socket drops without a graceful room:leave.
    const left = new Promise<{ userId: string; roomId: string }>(resolve => {
      hostSock.once('room:user-left', (p: { userId: string; roomId: string }) => resolve(p));
    });
    listenerSock.disconnect(); // ungraceful drop

    const evt = await left;
    expect(evt.userId).toBe(listener.id);
    expect(evt.roomId).toBe(roomId);

    // ...and the DB participation is closed out (leftAt stamped).
    const after = await prisma.participant.findUnique({
      where: { userId_roomId: { userId: listener.id, roomId } },
    });
    expect(after?.leftAt).not.toBeNull();

    hostSock.disconnect();
  }, 30_000);

  it('keeps participation until the same user disconnects their last device', async () => {
    const host = await register(app);
    const listener = await register(app);
    createdIds.push(host.id, listener.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Last device cleanup room' });
    const roomId = created.body.data.id as string;

    const [hostSock, phone, tablet] = await Promise.all([
      connectWith(host.token),
      connectWith(listener.token),
      connectWith(listener.token),
    ]);
    await Promise.all([
      joinRoom(hostSock, roomId),
      joinRoom(phone, roomId),
      joinRoom(tablet, roomId),
    ]);

    phone.disconnect();
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(
      await prisma.participant.count({ where: { roomId, userId: listener.id, leftAt: null } }),
    ).toBe(1);

    tablet.disconnect();
    await eventually(async () => {
      expect(
        await prisma.participant.count({ where: { roomId, userId: listener.id, leftAt: null } }),
      ).toBe(0);
    });
    hostSock.disconnect();
  }, 30_000);

  it('an authenticated REST leave evicts every device for that account from the room', async () => {
    const host = await register(app);
    const listener = await register(app);
    createdIds.push(host.id, listener.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Account-scoped leave room' });
    const roomId = created.body.data.id as string;

    const [hostSock, phone, tablet] = await Promise.all([
      connectWith(host.token),
      connectWith(listener.token),
      connectWith(listener.token),
    ]);
    await Promise.all([
      joinRoom(hostSock, roomId),
      joinRoom(phone, roomId),
      joinRoom(tablet, roomId),
    ]);

    const left = new Promise<{ userId: string; roomId: string }>(resolve => {
      hostSock.once('room:user-left', resolve);
    });
    const response = await request(app)
      .post(`/api/rooms/${roomId}/leave`)
      .set('Authorization', `Bearer ${listener.token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.changed).toBe(true);
    expect(await left).toEqual({ userId: listener.id, roomId });

    await eventually(async () => {
      const peers = await io.in(`room:${roomId}`).fetchSockets();
      expect(peers.some(peer => peer.data.userId === listener.id)).toBe(false);
      expect(
        await prisma.participant.count({ where: { roomId, userId: listener.id, leftAt: null } }),
      ).toBe(0);
    });

    phone.disconnect();
    tablet.disconnect();
    hostSock.disconnect();
  }, 30_000);

  it('simultaneous host/listener disconnects close the room without ghosts or deadlocks', async () => {
    const host = await register(app);
    const listener = await register(app);
    createdIds.push(host.id, listener.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Concurrent disconnect cleanup room' });
    const roomId = created.body.data.id as string;

    const [hostSock, listenerSock] = await Promise.all([
      connectWith(host.token),
      connectWith(listener.token),
    ]);
    await Promise.all([joinRoom(hostSock, roomId), joinRoom(listenerSock, roomId)]);

    hostSock.disconnect();
    listenerSock.disconnect();

    await eventually(async () => {
      const [room, activeParticipants, usersStillInRoom] = await Promise.all([
        prisma.room.findUniqueOrThrow({ where: { id: roomId } }),
        prisma.participant.count({ where: { roomId, leftAt: null } }),
        prisma.user.count({
          where: { id: { in: [host.id, listener.id] }, currentRoomId: roomId },
        }),
      ]);
      expect(room.endedAt).not.toBeNull();
      expect(room.isLive).toBe(false);
      expect(room.participantCount).toBe(0);
      expect(activeParticipants).toBe(0);
      expect(usersStillInRoom).toBe(0);
    });
  }, 30_000);
});
