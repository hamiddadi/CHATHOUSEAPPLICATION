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
const { connectRedis, disconnectRedis, redis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const username = `s_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
  };
};

describe('Socket.IO integration', () => {
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
    // io.close() also tears down the underlying HTTP server, so we must not
    // call server.close() afterwards — it would throw "Server is not running".
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

  it('rejects connection without a token', async () => {
    await expect(connectWith('')).rejects.toThrow();
  });

  it('rejects a socket token revoked by a tokenVersion bump (cross-device logout)', async () => {
    const user = await register(app);
    createdIds.push(user.id);

    // Baseline: the freshly minted token connects fine.
    const ok = await connectWith(user.token);
    ok.disconnect();

    // Simulate a cross-device logout / password reset: bump tokenVersion and
    // drop the cached auth verdict (exactly what invalidateUserAuthCache does on
    // the HTTP side). The old access token now carries a stale `tv`.
    await prisma.user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
    });
    await redis.del(`user:susp:${user.id}`);

    // The same (now stale) token must be rejected on the socket, just like HTTP.
    await expect(connectWith(user.token)).rejects.toThrow();
  }, 20_000);

  it('chat:send delivers the message to the receiver in real-time', async () => {
    const alice = await register(app);
    const bob = await register(app);
    createdIds.push(alice.id, bob.id);

    // DM requires mutual follow — establish both directions before send.
    await request(app).post(`/api/follow/${bob.id}`).set('Authorization', `Bearer ${alice.token}`);
    await request(app).post(`/api/follow/${alice.id}`).set('Authorization', `Bearer ${bob.token}`);

    const aSock = await connectWith(alice.token);
    const bSock = await connectWith(bob.token);

    const received = new Promise<{ content: string; senderId: string }>(resolve => {
      bSock.once('chat:message', (msg: { content: string; senderId: string }) => resolve(msg));
    });

    await new Promise<void>(resolve => {
      aSock.emit('chat:send', { receiverId: bob.id, content: 'hi via socket' }, () => resolve());
    });

    const msg = await received;
    expect(msg.content).toBe('hi via socket');
    expect(msg.senderId).toBe(alice.id);

    aSock.disconnect();
    bSock.disconnect();
  }, 20_000);
});
