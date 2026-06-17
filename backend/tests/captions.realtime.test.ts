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
// Mark the ASR provider configured so the captions on/off flag can be toggled
// (the relay only gates on the per-room Redis flag + speaker role, not on a
// live provider — the transcript is produced on-device).
process.env.ASR_PROVIDER = process.env.ASR_PROVIDER ?? 'whisper';
process.env.ASR_API_KEY = process.env.ASR_API_KEY ?? 'test-key';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { mountExtensions } =
  require('../src/extensions/mount') as typeof import('../src/extensions/mount');
const { createSocketServer } =
  require('../src/socket/socket.server') as typeof import('../src/socket/socket.server');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const username = `cap_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
  };
};

interface CaptionLine {
  id: string;
  speakerId: string;
  speakerName: string | null;
  text: string;
  isFinal: boolean;
  at: number;
}

describe('Live-captions realtime relay', () => {
  let app: Express;
  let server: http.Server;
  let io: IoServer;
  let url: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    // createApp() doesn't mount the /api/ext/* surface (bootstrap does, after
    // createApp). Mirror that here so the captions REST toggle is reachable.
    mountExtensions(app);
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

  it('relays a speaker caption to the room and drops a listener caption', async () => {
    const host = await register(app);
    const listener = await register(app);
    createdIds.push(host.id, listener.id);

    // Host creates a live room (becomes HOST participant).
    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Captions relay test room' });
    const roomId = created.body.data.id as string;
    expect(roomId).toBeTruthy();

    // Host turns captions ON for the room (host/mod authz + Redis flag).
    const toggled = await request(app)
      .post(`/api/ext/captions/${roomId}`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ enabled: true });
    expect(toggled.status).toBe(200);
    expect(toggled.body.enabled).toBe(true);

    const hostSock = await connectWith(host.token);
    const listenerSock = await connectWith(listener.token);
    await joinRoom(hostSock, roomId); // host joins the channel
    await joinRoom(listenerSock, roomId); // listener becomes LISTENER participant

    // ── Positive: the HOST (a speaker) publishes a caption → the listener
    // receives it, with the speakerId stamped server-side.
    const received = new Promise<CaptionLine>(resolve => {
      listenerSock.once('room:caption', (line: CaptionLine) => resolve(line));
    });
    hostSock.emit('caption:publish', {
      roomId,
      id: 'cap:host:0',
      text: 'hello from the stage',
      isFinal: true,
      speakerName: 'Host',
    });
    const line = await received;
    expect(line.text).toBe('hello from the stage');
    expect(line.speakerId).toBe(host.id);
    expect(line.isFinal).toBe(true);

    // ── Negative: a LISTENER publishing a caption is NOT relayed (not a
    // speaking participant). Assert the host hears nothing within a window.
    const leaked = new Promise<'leaked'>(resolve => {
      hostSock.once('room:caption', () => resolve('leaked'));
    });
    const quiet = new Promise<'quiet'>(resolve => setTimeout(() => resolve('quiet'), 1_000));
    listenerSock.emit('caption:publish', {
      roomId,
      id: 'cap:listener:0',
      text: 'i should be dropped',
      isFinal: true,
      speakerName: 'Listener',
    });
    await expect(Promise.race([leaked, quiet])).resolves.toBe('quiet');

    hostSock.disconnect();
    listenerSock.disconnect();
  }, 30_000);
});
