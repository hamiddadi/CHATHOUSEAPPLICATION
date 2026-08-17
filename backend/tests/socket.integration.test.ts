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

  it('logout revokes and disconnects every live device for the account', async () => {
    const user = await register(app);
    createdIds.push(user.id);

    const phone = await connectWith(user.token);
    const tablet = await connectWith(user.token);

    const revokedOn = (socket: ClientSocket) =>
      new Promise<{ reason: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('auth:revoked timeout')), 5_000);
        socket.once('auth:revoked', payload => {
          clearTimeout(timer);
          resolve(payload as { reason: string });
        });
      });
    const disconnected = (socket: ClientSocket) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('disconnect timeout')), 5_000);
        socket.once('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });

    const revoked = Promise.all([revokedOn(phone), revokedOn(tablet)]);
    const closed = Promise.all([disconnected(phone), disconnected(tablet)]);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${user.token}`);
    expect(logout.status).toBe(200);

    expect(await revoked).toEqual([{ reason: 'logout' }, { reason: 'logout' }]);
    await closed;
    expect(phone.connected).toBe(false);
    expect(tablet.connected).toBe(false);

    // The same access token cannot reconnect a third device after revocation.
    await expect(connectWith(user.token)).rejects.toThrow();
  }, 20_000);

  it('keeps map presence until the last device disconnects and streams metadata for new pins', async () => {
    const viewer = await register(app);
    const subject = await register(app);
    createdIds.push(viewer.id, subject.id);
    await prisma.user.update({
      where: { id: subject.id },
      data: { isVisible: true },
    });

    const viewerSocket = await connectWith(viewer.token);
    const phone = await connectWith(subject.token);
    const tablet = await connectWith(subject.token);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('maps:subscribe timeout')), 5_000);
      viewerSocket.emit('maps:subscribe', (ok: boolean) => {
        clearTimeout(timer);
        if (!ok) reject(new Error('maps:subscribe rejected'));
        else resolve();
      });
    });

    const moved = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('maps:user-moved timeout')), 5_000);
      viewerSocket.on('maps:user-moved', payload => {
        const row = payload as { userId?: string };
        if (row.userId !== subject.id) return;
        clearTimeout(timer);
        resolve(payload as Record<string, unknown>);
      });
    });
    await new Promise<void>((resolve, reject) => {
      phone.emit(
        'maps:update-location',
        { latitude: 48.8566, longitude: 2.3522 },
        (ok: boolean) => {
          if (!ok) reject(new Error('maps:update-location rejected'));
          else resolve();
        },
      );
    });
    expect(await moved).toEqual(
      expect.objectContaining({
        userId: subject.id,
        latitude: 48.85,
        longitude: 2.35,
        username: expect.any(String),
        lastSeenAt: expect.any(String),
      }),
    );

    let removedPrematurely = false;
    viewerSocket.on('maps:user-offline', (payload: { userId?: string }) => {
      if (payload.userId === subject.id) removedPrematurely = true;
    });
    phone.disconnect();
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(removedPrematurely).toBe(false);

    const removedAfterLastDevice = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('maps:user-offline timeout')), 5_000);
      viewerSocket.on('maps:user-offline', (payload: { userId?: string }) => {
        if (payload.userId !== subject.id) return;
        clearTimeout(timer);
        resolve();
      });
    });
    tablet.disconnect();
    await removedAfterLastDevice;
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: subject.id },
        select: { isOnline: true },
      }),
    ).toEqual({ isOnline: false });

    viewerSocket.disconnect();
  }, 20_000);

  it('streams exact GPS only to mutually accepted follows and coarse GPS to strangers', async () => {
    const stranger = await register(app);
    const trusted = await register(app);
    const subject = await register(app);
    createdIds.push(stranger.id, trusted.id, subject.id);
    await prisma.user.update({
      where: { id: subject.id },
      data: { isVisible: true },
    });

    await request(app)
      .post(`/api/follow/${subject.id}`)
      .set('Authorization', `Bearer ${trusted.token}`);
    await request(app)
      .post(`/api/follow/${trusted.id}`)
      .set('Authorization', `Bearer ${subject.token}`);

    const strangerSocket = await connectWith(stranger.token);
    const trustedSocket = await connectWith(trusted.token);
    const subjectSocket = await connectWith(subject.token);

    const subscribe = (socket: ClientSocket) =>
      new Promise<void>((resolve, reject) => {
        socket.emit('maps:subscribe', (ok: boolean) =>
          ok ? resolve() : reject(new Error('maps:subscribe rejected')),
        );
      });
    await Promise.all([subscribe(strangerSocket), subscribe(trustedSocket)]);

    const nextSubjectMove = (socket: ClientSocket) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('maps:user-moved timeout')), 5_000);
        socket.on('maps:user-moved', payload => {
          const row = payload as { userId?: string };
          if (row.userId !== subject.id) return;
          clearTimeout(timer);
          resolve(payload as Record<string, unknown>);
        });
      });
    const strangerMoved = nextSubjectMove(strangerSocket);
    const trustedMoved = nextSubjectMove(trustedSocket);

    await new Promise<void>((resolve, reject) => {
      subjectSocket.emit(
        'maps:update-location',
        { latitude: 48.8566, longitude: 2.3522 },
        (ok: boolean) => (ok ? resolve() : reject(new Error('maps:update-location rejected'))),
      );
    });

    expect(await strangerMoved).toEqual(
      expect.objectContaining({ latitude: 48.85, longitude: 2.35 }),
    );
    expect(await trustedMoved).toEqual(
      expect.objectContaining({ latitude: 48.8566, longitude: 2.3522 }),
    );

    strangerSocket.disconnect();
    trustedSocket.disconnect();
    subjectSocket.disconnect();
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
