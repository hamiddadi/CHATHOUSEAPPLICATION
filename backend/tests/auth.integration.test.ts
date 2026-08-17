import request from 'supertest';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';

// Point the test process at the running docker-compose stack.
// docker-compose maps Postgres on 5433 (host) → 5432 (container) to avoid a
// conflict with the host Postgres service.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Late imports so env overrides above take effect before config/env.ts freezes.
/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis, redis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { blacklistKey, revokeAccessToken } =
  require('../src/middlewares/auth.middleware') as typeof import('../src/middlewares/auth.middleware');
const { decodeTokenTtl, signAccessToken, verifyAccessToken, verifyRefreshToken } =
  require('../src/utils/jwt') as typeof import('../src/utils/jwt');
const { getRemindersQueue, shutdownReminders } =
  require('../src/queues/eventReminders') as typeof import('../src/queues/eventReminders');
const { shutdownReminder15 } =
  require('../src/extensions/queues/reminder15') as typeof import('../src/extensions/queues/reminder15');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

describe('Auth + Users integration', () => {
  let app: Express;
  let username: string;
  let email: string;
  const password = 'test-password-123';
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
    username = `t_${rand()}`;
    email = `${username}@test.local`;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await getRemindersQueue().drain(true);
    await shutdownReminders();
    await shutdownReminder15();
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('GET /health returns 200 when db + redis are healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.services).toEqual({ database: true, redis: true });
  });

  it('POST /api/auth/register creates a user and returns tokens', async () => {
    const res = await request(app).post('/api/auth/register').send({ username, email, password });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    createdIds.push(res.body.data.user.id);
  });

  it('POST /api/auth/register rejects duplicate email as AUTH_005', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: `${username}_bis`, email, password });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUTH_005');
  });

  it('maps a concurrent email registration collision to AUTH_005 instead of 500', async () => {
    const sharedEmail = `race_email_${rand()}@test.local`;
    const responses = await Promise.all(
      [0, 1].map(index =>
        request(app)
          .post('/api/auth/register')
          .send({ username: `race_email_${index}_${rand()}`, email: sharedEmail, password }),
      ),
    );

    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
    const winner = responses.find(response => response.status === 201);
    const rejected = responses.find(response => response.status === 409);
    if (!winner || !rejected) throw new Error('Expected one registration winner');
    createdIds.push(winner.body.data.user.id as string);
    expect(rejected.body.error.code).toBe('AUTH_005');
    expect(await prisma.user.count({ where: { email: sharedEmail } })).toBe(1);
  });

  it('maps a concurrent username registration collision to AUTH_006 instead of 500', async () => {
    const sharedUsername = `race_username_${rand()}`;
    const responses = await Promise.all(
      [0, 1].map(index =>
        request(app)
          .post('/api/auth/register')
          .send({
            username: index === 0 ? sharedUsername.toUpperCase() : sharedUsername,
            email: `race_username_${index}_${rand()}@test.local`,
            password,
          }),
      ),
    );

    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
    const winner = responses.find(response => response.status === 201);
    const rejected = responses.find(response => response.status === 409);
    if (!winner || !rejected) throw new Error('Expected one registration winner');
    createdIds.push(winner.body.data.user.id as string);
    expect(rejected.body.error.code).toBe('AUTH_006');
    expect(await prisma.user.count({ where: { username: sharedUsername } })).toBe(1);
  });

  it('POST /api/auth/login with email returns a fresh token pair', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: email, password });
    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
  });

  it('POST /api/auth/login with wrong password returns AUTH_001', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_001');
  });

  it('GET /api/users/me without token returns AUTH_003', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_003');
  });

  it('GET /api/users/me with a valid token returns the current user', async () => {
    const login = await request(app).post('/api/auth/login').send({ identifier: email, password });
    const accessToken = login.body.data.accessToken as string;

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe(username);
    expect(res.body.data.email).toBe(email);
  });

  it('creates notification defaults once under concurrent first reads', async () => {
    const prefsUsername = `prefs_${rand()}`;
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ username: prefsUsername, email: `${prefsUsername}@test.local`, password });
    expect(registered.status).toBe(201);
    const userId = registered.body.data.user.id as string;
    const accessToken = registered.body.data.accessToken as string;
    createdIds.push(userId);
    await prisma.notificationPreference.deleteMany({ where: { userId } });

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .get('/api/users/me/notification-preferences')
          .set('Authorization', `Bearer ${accessToken}`),
      ),
    );

    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(responses.map(response => response.body.data.id))).toHaveProperty('size', 1);
    expect(await prisma.notificationPreference.count({ where: { userId } })).toBe(1);
  });

  it('POST /api/auth/refresh rotates the refresh token', async () => {
    const login = await request(app).post('/api/auth/login').send({ identifier: email, password });
    const refreshToken = login.body.data.refreshToken as string;

    const first = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.data.refreshToken).not.toBe(refreshToken);

    // Replaying the original refresh token after rotation must fail
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_004');
  });

  it('POST /api/auth/logout blacklists the access token', async () => {
    const login = await request(app).post('/api/auth/login').send({ identifier: email, password });
    const accessToken = login.body.data.accessToken as string;

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logout.status).toBe(200);

    const claims = verifyAccessToken(accessToken);
    const revocationKey = blacklistKey(accessToken, claims.jti);
    expect(revocationKey).toBe(`blacklist:jti:${claims.jti}`);
    expect(revocationKey).not.toContain(accessToken);
    const blacklistTtl = await redis.ttl(revocationKey);
    expect(blacklistTtl).toBeGreaterThan(0);
    expect(blacklistTtl).toBeLessThanOrEqual(15 * 60);

    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('AUTH_004');

    // A replay cannot execute logout a second time or mutate session state.
    const currentUser = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { tokenVersion: true },
    });
    const replay = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_004');
    await expect(
      prisma.user.findUniqueOrThrow({ where: { email }, select: { tokenVersion: true } }),
    ).resolves.toEqual(currentUser);

    // Clean up the residual blacklist entry so we don't leak keys across runs
    await redis.del(revocationKey);
  });

  it('bounds an access-token revocation key by the signed token expiry', async () => {
    const token = signAccessToken('ttl-test-user');
    const claims = verifyAccessToken(token);
    const key = blacklistKey(token, claims.jti);
    const signedTtl = decodeTokenTtl(token);

    await revokeAccessToken(token, Number.MAX_SAFE_INTEGER);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(signedTtl);
    await redis.del(key);
  });

  it('keeps revocation compatible with pre-rollout access tokens without jti', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true, tokenVersion: true },
    });
    const legacyToken = jwt.sign(
      { sub: user.id, typ: 'access', tv: user.tokenVersion },
      process.env.JWT_ACCESS_SECRET!,
      {
        algorithm: 'HS256',
        issuer: 'chathouse-api',
        audience: 'chathouse-app',
        expiresIn: '5m',
      },
    );
    const key = blacklistKey(legacyToken);
    expect(key).toMatch(/^blacklist:[a-f0-9]{64}$/);

    const before = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${legacyToken}`);
    expect(before.status).toBe(200);

    await revokeAccessToken(legacyToken, decodeTokenTtl(legacyToken));
    const replay = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${legacyToken}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('AUTH_004');
    await redis.del(key);
  });

  it('requires explicit confirmation before restoring a self-deleted account', async () => {
    const restoreUsername = `restore_${rand()}`;
    const restoreEmail = `${restoreUsername}@test.local`;
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ username: restoreUsername, email: restoreEmail, password });
    expect(registered.status).toBe(201);
    const id = registered.body.data.user.id as string;
    const oldAccessToken = registered.body.data.accessToken as string;
    createdIds.push(id);

    // Warm the clean auth verdict, then prove a post-commit Redis failure does
    // not turn the already committed deletion into a 500 or skip cleanup.
    const warmAuthCache = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${oldAccessToken}`);
    expect(warmAuthCache.status).toBe(200);
    const deletionCacheFailure = jest
      .spyOn(redis, 'setEx')
      .mockRejectedValueOnce(new Error('simulated deletion cache outage'));
    let deletion;
    try {
      deletion = await request(app)
        .post('/api/users/me/request-deletion')
        .set('Authorization', `Bearer ${oldAccessToken}`);
    } finally {
      deletionCacheFailure.mockRestore();
    }
    expect(deletion.status).toBe(200);
    expect(deletion.body.data.permanentDeletionAt).toEqual(expect.any(String));

    // Remove the deliberately stale verdict left by the simulated cache
    // outage; its production TTL is bounded, while PostgreSQL is authoritative.
    await redis.del(`user:susp:${id}`);
    const disabled = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${oldAccessToken}`);
    expect(disabled.status).toBe(401);

    const recoveryLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: restoreEmail, password });
    expect(recoveryLogin.status).toBe(200);
    expect(recoveryLogin.body.data).toMatchObject({
      scope: 'account_recovery',
      user: {
        id,
        accountState: 'PENDING_DELETION',
      },
    });
    expect(recoveryLogin.body.data.user.deletedAt).toEqual(expect.any(String));
    expect(recoveryLogin.body.data.user.permanentDeletionAt).toEqual(expect.any(String));
    const recoveryAccess = recoveryLogin.body.data.accessToken as string;
    const recoveryRefresh = recoveryLogin.body.data.refreshToken as string;
    expect(verifyAccessToken(recoveryAccess).scope).toBe('account_recovery');

    // Credential proof alone must leave the deletion marker untouched.
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();

    // The recovery session can read only the authoritative account view.
    const pendingMe = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${recoveryAccess}`);
    expect(pendingMe.status).toBe(200);
    expect(pendingMe.body.data.accountState).toBe('PENDING_DELETION');

    const deniedNormalAction = await request(app)
      .patch('/api/users/me/visibility')
      .set('Authorization', `Bearer ${recoveryAccess}`)
      .send({ isVisible: true });
    expect(deniedNormalAction.status).toBe(403);
    expect(deniedNormalAction.body.error.code).toBe('ACCOUNT_002');

    // Refresh preserves the signed recovery scope; it can never upgrade the
    // session to active without explicit cancellation.
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: recoveryRefresh });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.scope).toBe('account_recovery');
    const refreshedRecoveryAccess = refreshed.body.data.accessToken as string;
    expect(verifyAccessToken(refreshedRecoveryAccess).scope).toBe('account_recovery');

    // A post-commit Redis failure must not hide the successful restoration or
    // strand the client without the atomically created active credential.
    const cacheFailure = jest
      .spyOn(redis, 'del')
      .mockRejectedValueOnce(new Error('simulated cache outage'));
    let restored;
    try {
      restored = await request(app)
        .post('/api/users/me/cancel-deletion')
        .set('Authorization', `Bearer ${refreshedRecoveryAccess}`);
    } finally {
      cacheFailure.mockRestore();
    }
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({
      cancelled: true,
      session: { scope: 'active' },
      user: { id, accountState: 'ACTIVE', deletedAt: null, permanentDeletionAt: null },
    });
    const activeAccess = restored.body.data.session.accessToken as string;
    const activeRefresh = restored.body.data.session.refreshToken as string;
    expect(verifyAccessToken(activeAccess).scope).toBeUndefined();
    const activeRefreshClaims = verifyRefreshToken(activeRefresh);
    expect(activeRefreshClaims.scope).toBeUndefined();
    await expect(
      prisma.refreshToken.findUnique({ where: { token: activeRefreshClaims.jti } }),
    ).resolves.toMatchObject({ userId: id, revokedAt: null });

    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { deletedAt: true, isVisible: true, latitude: true, longitude: true },
    });
    expect(row).toEqual({
      deletedAt: null,
      isVisible: false,
      latitude: null,
      longitude: null,
    });

    // Clear the deliberately stale cache marker left by the simulated outage;
    // production naturally self-heals when its bounded TTL expires.
    await redis.del(`user:susp:${id}`);
    const activeMe = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${activeAccess}`);
    expect(activeMe.status).toBe(200);
    expect(activeMe.body.data.accountState).toBe('ACTIVE');

    // A previously issued recovery bearer remains incapable of using normal
    // application routes even after the account becomes active.
    const recoveryReplay = await request(app)
      .patch('/api/users/me/visibility')
      .set('Authorization', `Bearer ${recoveryAccess}`)
      .send({ isVisible: true });
    expect(recoveryReplay.status).toBe(403);
    expect(recoveryReplay.body.error.code).toBe('ACCOUNT_002');
  });

  it('cancels future hosted events permanently when a restorable account is deleted', async () => {
    const restoreUsername = `restore_event_${rand()}`;
    const restoreEmail = `${restoreUsername}@test.local`;
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ username: restoreUsername, email: restoreEmail, password });
    const id = registered.body.data.user.id as string;
    const token = registered.body.data.accessToken as string;
    createdIds.push(id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: `Deletion event ${rand()}`,
        scheduledFor: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
      });
    expect(created.status).toBe(201);
    const roomId = created.body.data.id as string;
    const queue = getRemindersQueue();
    expect(await queue.getJob(`room-golive-${roomId}`)).toBeTruthy();

    const deletion = await request(app)
      .post('/api/users/me/request-deletion')
      .set('Authorization', `Bearer ${token}`);
    expect(deletion.status).toBe(200);

    const canceled = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    expect(canceled).toMatchObject({
      isLive: false,
      participantCount: 0,
    });
    expect(canceled.endedAt).not.toBeNull();
    expect(canceled.canceledAt).not.toBeNull();
    expect(await queue.getJob(`room-reminder-${roomId}`)).toBeFalsy();
    expect(await queue.getJob(`room-golive-${roomId}`)).toBeFalsy();

    const recoveryLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: restoreEmail, password });
    expect(recoveryLogin.status).toBe(200);
    expect(recoveryLogin.body.data.scope).toBe('account_recovery');
    const restored = await request(app)
      .post('/api/users/me/cancel-deletion')
      .set('Authorization', `Bearer ${recoveryLogin.body.data.accessToken as string}`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.session.scope).toBe('active');
    expect((await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).endedAt).not.toBeNull();
  });

  it('does not restore a self-deleted account after the 30-day grace period', async () => {
    const expiredUsername = `expired_${rand()}`;
    const expiredEmail = `${expiredUsername}@test.local`;
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ username: expiredUsername, email: expiredEmail, password });
    const id = registered.body.data.user.id as string;
    createdIds.push(id);

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: expiredEmail, password });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('AUTH_003');
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
  });

  it('never restores an admin-deleted or actively suspended account', async () => {
    const bannedUsername = `banned_${rand()}`;
    const bannedEmail = `${bannedUsername}@test.local`;
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ username: bannedUsername, email: bannedEmail, password });
    const id = registered.body.data.user.id as string;
    createdIds.push(id);

    await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        suspendedUntil: new Date('9999-12-31T23:59:59.000Z'),
      },
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: bannedEmail, password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('AUTH_007');
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
  });

  it('PATCH /api/users/me/visibility toggles Ghost Mode', async () => {
    const login = await request(app).post('/api/auth/login').send({ identifier: email, password });
    const accessToken = login.body.data.accessToken as string;

    const off = await request(app)
      .patch('/api/users/me/visibility')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isVisible: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isVisible).toBe(false);

    const on = await request(app)
      .patch('/api/users/me/visibility')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isVisible: true });
    expect(on.body.data.isVisible).toBe(true);
  });
});
