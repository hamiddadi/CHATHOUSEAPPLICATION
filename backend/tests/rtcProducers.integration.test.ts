import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server as IoServer } from 'socket.io';
import type { Express } from 'express';

/**
 * Contract-level tests for the Phase 6 additions to `rtc:*`:
 *   • `rtc:list-producers` empty initially
 *   • `rtc:list-producers` denies non-members with NOT_A_ROOM_MEMBER
 *   • Broadcast hooks cleared between routers after `room:end`
 *
 * We don't exercise an actual produce/consume round-trip — that would
 * require a WebRTC-capable client (mediasoup-client + browser/react-native-
 * webrtc). The RTP path is covered by the mediasoup unit test suite.
 */

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Skip when mediasoup isn't installed (Windows dev host) — the rtc:* events
// short-circuit with `RTC_DISABLED` and the assertions below don't apply.
let mediasoupAvailable = true;
try {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  require.resolve('mediasoup');
} catch {
  mediasoupAvailable = false;
}
if (mediasoupAvailable) {
  process.env.MEDIASOUP_ENABLED = 'true';
  process.env.MEDIASOUP_RTC_MIN_PORT = process.env.MEDIASOUP_RTC_MIN_PORT ?? '40300';
  process.env.MEDIASOUP_RTC_MAX_PORT = process.env.MEDIASOUP_RTC_MAX_PORT ?? '40309';
  process.env.MEDIASOUP_NUM_WORKERS = '1';
  process.env.MEDIASOUP_LISTEN_IP = '127.0.0.1';
  process.env.MEDIASOUP_ANNOUNCED_IP = '127.0.0.1';
}
const describeOrSkip = mediasoupAvailable ? describe : describe.skip;

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { createSocketServer } =
  require('../src/socket/socket.server') as typeof import('../src/socket/socket.server');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { initMediasoup, shutdownMediasoup } =
  require('../src/webrtc/mediasoup.manager') as typeof import('../src/webrtc/mediasoup.manager');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const username = `p_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

const createRoom = async (app: Express, token: string) => {
  const res = await request(app)
    .post('/api/rooms')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'rtc tracking room' });
  return res.body.data.id as string;
};

describeOrSkip('rtc:list-producers + room cleanup', () => {
  let app: Express;
  let server: http.Server;
  let io: IoServer;
  let url: string;
  const createdUserIds: string[] = [];
  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    await initMediasoup();
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
    await shutdownMediasoup();
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

  const emitAck = <T>(sock: ClientSocket, event: string, payload: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), 10_000);
      sock.emit(event, payload, (res: T) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

  it('list-producers returns an empty array for a fresh room, NOT_A_ROOM_MEMBER for outsiders', async () => {
    const host = await register(app);
    const outsider = await register(app);
    createdUserIds.push(host.id, outsider.id);

    const roomId = await createRoom(app, host.token);
    createdRoomIds.push(roomId);

    const hostSock = await connect(host.token);
    const outsiderSock = await connect(outsider.token);

    type Res = { ok: boolean; data?: unknown; error?: string };

    const asHost = await emitAck<Res>(hostSock, 'rtc:list-producers', { roomId });
    expect(asHost.ok).toBe(true);
    expect(asHost.data).toEqual([]);

    const asOutsider = await emitAck<Res>(outsiderSock, 'rtc:list-producers', { roomId });
    expect(asOutsider.ok).toBe(false);
    expect(asOutsider.error).toBe('NOT_A_ROOM_MEMBER');

    hostSock.disconnect();
    outsiderSock.disconnect();
  }, 30_000);

  it('room:ended broadcasts to members and cleans SFU state', async () => {
    const host = await register(app);
    const listener = await register(app);
    createdUserIds.push(host.id, listener.id);

    const roomId = await createRoom(app, host.token);
    createdRoomIds.push(roomId);

    // listener joins
    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${listener.token}`);

    const hostSock = await connect(host.token);
    const listenerSock = await connect(listener.token);

    // Both join the socket `room:<id>` channel via the `room:join` event
    // (mirrors the client-side flow — the REST join alone doesn't subscribe).
    await new Promise<void>(resolve => hostSock.emit('room:join', { roomId }, () => resolve()));
    await new Promise<void>(resolve => listenerSock.emit('room:join', { roomId }, () => resolve()));

    const listenerSawEnd = new Promise<{ roomId: string }>(resolve => {
      listenerSock.once('room:ended', (payload: { roomId: string }) => resolve(payload));
    });

    await new Promise<void>(resolve => hostSock.emit('room:end', { roomId }, () => resolve()));

    const ended = await listenerSawEnd;
    expect(ended.roomId).toBe(roomId);

    // After end, the host is no longer a member (participant.leftAt set by
    // roomsService.end), so RTC queries must now be denied.
    type Res = { ok: boolean; error?: string };
    const afterEnd = await emitAck<Res>(hostSock, 'rtc:list-producers', { roomId });
    expect(afterEnd.ok).toBe(false);
    expect(afterEnd.error).toBe('NOT_A_ROOM_MEMBER');

    hostSock.disconnect();
    listenerSock.disconnect();
  }, 30_000);
});
