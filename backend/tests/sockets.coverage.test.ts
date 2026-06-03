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
const { roomChannel } =
  require('../src/socket/channels') as typeof import('../src/socket/channels');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const u = `sk_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

describe('Socket.IO — room broadcasts + chat presence events', () => {
  let app: Express;
  let server: http.Server;
  let io: IoServer;
  let url: string;
  const createdUserIds: string[] = [];
  const createdRoomIds: string[] = [];

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
    for (const id of createdRoomIds) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await new Promise<void>(resolve => io.close(() => resolve()));
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

  const emitWithAck = <T>(sock: ClientSocket, event: string, payload: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), 5_000);
      sock.emit(event, payload, (res: T) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

  const waitForEvent = <T>(sock: ClientSocket, event: string, timeoutMs = 5_000): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      sock.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  // 4.1 — room:join broadcasts to existing members
  it('room:join broadcasts room:user-joined to existing members', async () => {
    const alice = await register(app);
    const bob = await register(app);
    createdUserIds.push(alice.id, bob.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ title: 'broadcast room' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    // Bob joins via REST so isActiveRoomParticipant is true before socket join
    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${bob.token}`);

    const aliceSock = await connect(alice.token);
    const bobSock = await connect(bob.token);

    await emitWithAck(aliceSock, 'room:join', { roomId });

    const joinedPromise = waitForEvent<{ userId: string; roomId: string }>(
      aliceSock,
      'room:user-joined',
    );
    await emitWithAck(bobSock, 'room:join', { roomId });

    const joined = await joinedPromise;
    expect(joined.userId).toBe(bob.id);
    expect(joined.roomId).toBe(roomId);

    aliceSock.disconnect();
    bobSock.disconnect();
  }, 30_000);

  // 4.3 — room:mute broadcasts isMuted changes
  it('room:mute broadcasts mute-changed to room members', async () => {
    const host = await register(app);
    const peer = await register(app);
    createdUserIds.push(host.id, peer.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'mute room' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${peer.token}`);

    const hostSock = await connect(host.token);
    const peerSock = await connect(peer.token);
    await emitWithAck(hostSock, 'room:join', { roomId });
    await emitWithAck(peerSock, 'room:join', { roomId });

    const muteChangedOnPeer = waitForEvent<{ userId: string; isMuted: boolean }>(
      peerSock,
      'room:mute-changed',
    );
    await emitWithAck(hostSock, 'room:mute', { roomId, isMuted: true });
    const msg = await muteChangedOnPeer;
    // The event also carries roomId now; assert the required fields are present
    // rather than an exact shape so adding context fields isn't a breaking test.
    expect(msg).toMatchObject({ userId: host.id, isMuted: true });

    hostSock.disconnect();
    peerSock.disconnect();
  }, 30_000);

  // 4.6 — room:request-speak broadcasts to HOST (everyone in the room channel)
  it('room:request-speak broadcasts the requester to the room', async () => {
    const host = await register(app);
    const askr = await register(app);
    createdUserIds.push(host.id, askr.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'speak room' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${askr.token}`);

    const hostSock = await connect(host.token);
    const askrSock = await connect(askr.token);
    await emitWithAck(hostSock, 'room:join', { roomId });
    await emitWithAck(askrSock, 'room:join', { roomId });

    const incoming = waitForEvent<{ userId: string; roomId: string }>(
      hostSock,
      'room:speak-request',
    );
    askrSock.emit('room:request-speak', { roomId });
    const payload = await incoming;
    expect(payload.userId).toBe(askr.id);
    expect(payload.roomId).toBe(roomId);

    hostSock.disconnect();
    askrSock.disconnect();
  }, 30_000);

  // 4.10 — moderator kick forcibly evicts the target's socket from the room
  // channel (server-enforced, not client-cooperative).
  it('kick forcibly removes the target socket from the room channel', async () => {
    const host = await register(app);
    const target = await register(app);
    createdUserIds.push(host.id, target.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'kick room' });
    const roomId = created.body.data.id as string;
    createdRoomIds.push(roomId);

    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${target.token}`);

    const hostSock = await connect(host.token);
    const targetSock = await connect(target.token);
    await emitWithAck(hostSock, 'room:join', { roomId });
    await emitWithAck(targetSock, 'room:join', { roomId });

    // Server-side socket ids (=== the connected client ids). Narrow away the
    // `string | undefined` the client type carries pre-connect.
    const hostSid = hostSock.id;
    const targetSid = targetSock.id;
    if (!hostSid || !targetSid) throw new Error('expected both sockets to be connected');

    // Membership is read from the live (local) adapter room map by socket id —
    // synchronous and authoritative, vs. fetchSockets() which does a Redis
    // round-trip that can read a stale snapshot.
    const roomMembers = (): Set<string> =>
      io.sockets.adapter.rooms.get(roomChannel(roomId)) ?? new Set<string>();
    const waitUntil = (cond: () => boolean, timeoutMs = 2_000): Promise<void> =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = (): void => {
          if (cond()) return resolve();
          if (Date.now() - start >= timeoutMs) return reject(new Error('waitUntil timeout'));
          setTimeout(tick, 25);
        };
        tick();
      });

    // Both sockets are members of the room channel before the kick.
    expect(roomMembers().has(hostSid)).toBe(true);
    expect(roomMembers().has(targetSid)).toBe(true);

    // Host kicks target via REST. The target must get a direct personal signal
    // on its user channel AND be evicted from the room channel server-side.
    const kicked = waitForEvent<{ roomId: string; kickedBy: string }>(
      targetSock,
      'room:you_were_kicked',
    );
    await request(app)
      .post(`/api/rooms/${roomId}/kick`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ userId: target.id });

    expect(await kicked).toMatchObject({ roomId, kickedBy: host.id });

    // socketsLeave propagates through the adapter; poll until the target is
    // evicted (bounded, so a genuine no-op still fails fast).
    await waitUntil(() => !roomMembers().has(targetSid));

    // Eviction is targeted: the host (and the channel) survive.
    expect(roomMembers().has(targetSid)).toBe(false);
    expect(roomMembers().has(hostSid)).toBe(true);

    hostSock.disconnect();
    targetSock.disconnect();
  }, 30_000);

  // 5.8 — chat:typing relayed to the receiver only
  it('chat:typing relays senderId to the receiver socket', async () => {
    const alice = await register(app);
    const bob = await register(app);
    createdUserIds.push(alice.id, bob.id);

    const aliceSock = await connect(alice.token);
    const bobSock = await connect(bob.token);

    const typingPromise = waitForEvent<{ senderId: string }>(bobSock, 'chat:typing');
    aliceSock.emit('chat:typing', { receiverId: bob.id });
    const payload = await typingPromise;
    expect(payload.senderId).toBe(alice.id);

    aliceSock.disconnect();
    bobSock.disconnect();
  }, 20_000);

  // 5.9 — chat:read confirmation back to the sender
  it('chat:read notifies the original sender', async () => {
    const alice = await register(app);
    const bob = await register(app);
    createdUserIds.push(alice.id, bob.id);

    // Establish mutual follow so the DM send is allowed.
    await request(app).post(`/api/follow/${bob.id}`).set('Authorization', `Bearer ${alice.token}`);
    await request(app).post(`/api/follow/${alice.id}`).set('Authorization', `Bearer ${bob.token}`);

    // Alice sends a message to Bob via REST
    const msgRes = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'please read this' });
    const messageId = msgRes.body.data.id as string;

    const aliceSock = await connect(alice.token);
    const bobSock = await connect(bob.token);

    const readConfirmOnAlice = waitForEvent<{ messageId: string }>(aliceSock, 'chat:read');
    bobSock.emit('chat:read', { messageId });
    const payload = await readConfirmOnAlice;
    expect(payload.messageId).toBe(messageId);

    aliceSock.disconnect();
    bobSock.disconnect();
  }, 20_000);
});
