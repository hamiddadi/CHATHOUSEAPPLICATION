import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Server as IoServer } from 'socket.io';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5434/chathouse_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { createSocketServer } =
  require('../src/socket/socket.server') as typeof import('../src/socket/socket.server');
const { disconnectUserSockets } =
  require('../src/socket/realtime') as typeof import('../src/socket/realtime');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis, redis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { blacklistKey } =
  require('../src/middlewares/auth.middleware') as typeof import('../src/middlewares/auth.middleware');
const { signAccessToken, signImpersonationToken, verifyAccessToken } =
  require('../src/utils/jwt') as typeof import('../src/utils/jwt');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('impersonation session boundaries', () => {
  let app: Express;
  let server: http.Server;
  let io: IoServer;
  let socketUrl: string;
  const suffix = Math.random().toString(36).slice(2, 10);
  const controllerId = `imp_controller_${suffix}`;
  const actorId = `imp_actor_${suffix}`;
  const targetId = `imp_target_${suffix}`;
  const denylistKeys = new Set<string>();
  const sockets = new Set<ClientSocket>();

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    server = http.createServer(app);
    io = await createSocketServer(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    socketUrl = `http://127.0.0.1:${address.port}`;
    await prisma.user.createMany({
      data: [
        { id: controllerId, username: `imp_controller_${suffix}`, appRole: 'SUPER_ADMIN' },
        { id: actorId, username: `imp_actor_${suffix}`, appRole: 'SUPER_ADMIN' },
        { id: targetId, username: `imp_target_${suffix}`, appRole: 'USER' },
      ],
    });
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: controllerId },
      data: { appRole: 'SUPER_ADMIN', suspendedUntil: null, deletedAt: null, tokenVersion: 0 },
    });
    await prisma.user.update({
      where: { id: actorId },
      data: { appRole: 'SUPER_ADMIN', suspendedUntil: null, deletedAt: null, tokenVersion: 0 },
    });
    await prisma.user.update({
      where: { id: targetId },
      data: { suspendedUntil: null, deletedAt: null, tokenVersion: 0 },
    });
    await redis.del([`user:susp:${controllerId}`, `user:susp:${actorId}`, `user:susp:${targetId}`]);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise<void>(resolve => io.close(() => resolve()));
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [controllerId, actorId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [controllerId, actorId, targetId] } } });
    await redis.del([
      ...denylistKeys,
      `user:susp:${controllerId}`,
      `user:susp:${actorId}`,
      `user:susp:${targetId}`,
    ]);
    await prisma.$disconnect();
    await disconnectRedis();
  });

  const startImpersonation = async (actorToken: string): Promise<string> => {
    const started = await request(app)
      .post(`/api/admin/users/${targetId}/impersonate`)
      .set('Authorization', `Bearer ${actorToken}`);
    expect(started.status).toBe(200);
    return started.body.data.token as string;
  };

  const connectWith = (token: string): Promise<ClientSocket> =>
    new Promise((resolve, reject) => {
      const socket = ioClient(socketUrl, {
        transports: ['websocket'],
        auth: { token },
        reconnection: false,
        forceNew: true,
      });
      sockets.add(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });

  const onceWithTimeout = <T>(socket: ClientSocket, event: string, timeoutMs = 5_000): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} timeout`)), timeoutMs);
      socket.once(event, payload => {
        clearTimeout(timer);
        resolve(payload as T);
      });
    });

  it('rejects every impersonation bearer at the central admin boundary', async () => {
    const actorToken = signAccessToken(actorId, 0);
    const token = await startImpersonation(actorToken);

    const response = await request(app)
      .get('/api/admin/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_008');
  });

  it('revokes the exact delegated jti before recording impersonation end', async () => {
    const actorToken = signAccessToken(actorId, 0);
    const token = await startImpersonation(actorToken);
    const claims = verifyAccessToken(token);
    const denylistKey = blacklistKey(token, claims.jti);
    denylistKeys.add(denylistKey);

    const stopped = await request(app)
      .post(`/api/admin/users/${targetId}/stop-impersonating`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ token });
    expect(stopped.status).toBe(200);
    expect(await redis.get(denylistKey)).toBe('1');

    const replay = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_004');

    const ended = await prisma.auditLog.findFirst({
      where: { actorId, targetUserId: targetId, action: 'IMPERSONATION_ENDED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ended).not.toBeNull();
  });

  it('does not revoke a delegated token through a different target path', async () => {
    const actorToken = signAccessToken(actorId, 0);
    const token = await startImpersonation(actorToken);

    const stopped = await request(app)
      .post(`/api/admin/users/not-${targetId}/stop-impersonating`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ token });
    expect(stopped.status).toBe(401);
    expect(stopped.body.error.code).toBe('AUTH_003');

    const stillActive = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(stillActive.status).toBe(200);
    expect(stillActive.body.data.id).toBe(targetId);
  });

  it("does not let an admin revoke another actor's delegated token", async () => {
    const actorToken = signAccessToken(actorId, 0);
    const otherActorToken = signImpersonationToken(targetId, `other-${actorId}`, 0, 0);

    const stopped = await request(app)
      .post(`/api/admin/users/${targetId}/stop-impersonating`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ token: otherActorToken });
    expect(stopped.status).toBe(401);
    expect(stopped.body.error.code).toBe('AUTH_003');
  });

  it('rejects an already-issued impersonation token immediately after actor demotion', async () => {
    const actorToken = signAccessToken(actorId, 0);
    const token = await startImpersonation(actorToken);

    const before = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);
    expect(before.body.data.id).toBe(targetId);

    await prisma.user.update({ where: { id: actorId }, data: { appRole: 'ADMIN' } });

    const after = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('AUTH_004');
  });

  it('stopping one delegated jti preserves the other bearer and genuine target session', async () => {
    const actorToken = signAccessToken(actorId, 0);
    const targetToken = signAccessToken(targetId, 0);
    const delegatedToken = await startImpersonation(actorToken);
    const otherDelegatedToken = await startImpersonation(actorToken);
    const delegatedClaims = verifyAccessToken(delegatedToken);
    denylistKeys.add(blacklistKey(delegatedToken, delegatedClaims.jti));

    const genuineTarget = await connectWith(targetToken);
    const delegated = await connectWith(delegatedToken);
    const otherDelegated = await connectWith(otherDelegatedToken);
    const revoked = onceWithTimeout<{ reason: string }>(delegated, 'auth:revoked');
    const disconnected = onceWithTimeout<void>(delegated, 'disconnect');

    const stopped = await request(app)
      .post(`/api/admin/users/${targetId}/stop-impersonating`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ token: delegatedToken });

    expect(stopped.status).toBe(200);
    await expect(revoked).resolves.toEqual({ reason: 'impersonation_ended' });
    await disconnected;
    expect(delegated.connected).toBe(false);
    expect(otherDelegated.connected).toBe(true);
    expect(genuineTarget.connected).toBe(true);
  });

  it("revoking the actor disconnects all of that actor's delegated sockets", async () => {
    const first = await connectWith(signImpersonationToken(targetId, actorId, 0, 0));
    const second = await connectWith(signImpersonationToken(targetId, actorId, 0, 0));
    const genuineTarget = await connectWith(signAccessToken(targetId, 0));
    const firstRevoked = onceWithTimeout<{ reason: string }>(first, 'auth:revoked');
    const secondRevoked = onceWithTimeout<{ reason: string }>(second, 'auth:revoked');
    const firstDisconnected = onceWithTimeout<void>(first, 'disconnect');
    const secondDisconnected = onceWithTimeout<void>(second, 'disconnect');
    const firstId = first.id;
    const secondId = second.id;
    const genuineTargetId = genuineTarget.id;

    disconnectUserSockets(actorId, 'logout');

    // The local sockets are gone before Redis has a chance to loop the cluster
    // command back to this process; the genuine target is not selected.
    expect(io.sockets.sockets.has(firstId!)).toBe(false);
    expect(io.sockets.sockets.has(secondId!)).toBe(false);
    expect(io.sockets.sockets.has(genuineTargetId!)).toBe(true);
    await expect(firstRevoked).resolves.toEqual({ reason: 'logout' });
    await expect(secondRevoked).resolves.toEqual({ reason: 'logout' });
    await Promise.all([firstDisconnected, secondDisconnected]);
    expect(first.connected).toBe(false);
    expect(second.connected).toBe(false);
    expect(genuineTarget.connected).toBe(true);
  });

  it("disconnects an actor's delegated socket on demotion but preserves its primary socket", async () => {
    const controllerToken = signAccessToken(controllerId, 0);
    const actorToken = signAccessToken(actorId, 0);
    const primaryActor = await connectWith(actorToken);
    const delegated = await connectWith(await startImpersonation(actorToken));
    const revoked = onceWithTimeout<{ reason: string }>(delegated, 'auth:revoked');
    const disconnected = onceWithTimeout<void>(delegated, 'disconnect');

    const demoted = await request(app)
      .patch(`/api/admin/users/${actorId}/role`)
      .set('Authorization', `Bearer ${controllerToken}`)
      .send({ role: 'ADMIN' });

    expect(demoted.status).toBe(200);
    await expect(revoked).resolves.toEqual({ reason: 'authorization_changed' });
    await disconnected;
    expect(delegated.connected).toBe(false);
    expect(primaryActor.connected).toBe(true);
    expect(io.sockets.sockets.has(primaryActor.id!)).toBe(true);
  });

  it('disconnects a delegated socket at the impersonation JWT expiry', async () => {
    const delegated = await connectWith(signImpersonationToken(targetId, actorId, 0, 0, 2));
    const revoked = onceWithTimeout<{ reason: string }>(delegated, 'auth:revoked', 5_000);
    const disconnected = onceWithTimeout<void>(delegated, 'disconnect', 5_000);

    await expect(revoked).resolves.toEqual({ reason: 'impersonation_expired' });
    await disconnected;
    expect(delegated.connected).toBe(false);
  });
});
