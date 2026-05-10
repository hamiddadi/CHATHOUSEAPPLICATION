import request from 'supertest';
import type { Express } from 'express';

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

    const me = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('AUTH_004');

    // Clean up the residual blacklist entry so we don't leak keys across runs
    await redis.del(`blacklist:${accessToken}`);
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
