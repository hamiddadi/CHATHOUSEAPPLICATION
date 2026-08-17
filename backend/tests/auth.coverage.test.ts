import express, { type Express } from 'express';
import request from 'supertest';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { createRateLimiter } =
  require('../src/middlewares/rateLimit.middleware') as typeof import('../src/middlewares/rateLimit.middleware');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

describe('Auth — audit coverage gaps', () => {
  let app: Express;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  // 1.3 — Username duplicate (AUTH_006)
  it('rejects duplicate username with AUTH_006', async () => {
    const username = `ac_${rand()}`;
    const first = await request(app)
      .post('/api/auth/register')
      .send({ username, email: `${username}-a@test.local`, password: 'test-password-123' });
    expect(first.status).toBe(201);
    createdIds.push(first.body.data.user.id);

    const second = await request(app)
      .post('/api/auth/register')
      .send({ username, email: `${username}-b@test.local`, password: 'test-password-123' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('AUTH_006');
  });

  // 1.4 — Zod validation (400 VALIDATION_001 with field-level details)
  it.each<[string, Record<string, unknown>]>([
    [
      'invalid email',
      { username: `v_${rand()}`, email: 'not-an-email', password: 'test-password-123' },
    ],
    [
      'short password',
      { username: `v_${rand()}`, email: `${rand()}@test.local`, password: 'short' },
    ],
    [
      'username with spaces',
      { username: 'bad name', email: `${rand()}@test.local`, password: 'test-password-123' },
    ],
    ['missing username', { email: `${rand()}@test.local`, password: 'test-password-123' }],
  ])('Zod validation rejects %s with VALIDATION_001', async (_label, body) => {
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  // 1.9 — Refresh with a bogus/expired token (AUTH_003 via JsonWebTokenError mapping)
  it('refresh with a garbage token returns AUTH_003', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'garbage-garbage-garbage-garbage-x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_003');
  });

  // 1.7 — Login with a non-existent identifier returns AUTH_001
  // (Spec table says "404" but our backend returns 401 AUTH_001 to avoid
  // a user-enumeration oracle — identical to the wrong-password path.)
  it('login with an unknown user returns AUTH_001 (401) — anti-enumeration', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: `nobody-${rand()}@test.local`, password: 'whatever-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_001');
  });

  // 1.13 — Use a dedicated limiter instance and MemoryStore so this burst
  // cannot consume the process-wide auth quota used by other integration
  // suites. The route deliberately fails, matching authLimiter's
  // skipSuccessfulRequests policy while exercising our real response contract.
  it('login rate limiter returns 429 RATE_LIMIT_001 under an isolated burst', async () => {
    const isolatedApp = express();
    isolatedApp.use(express.json());
    isolatedApp.post(
      '/login',
      createRateLimiter('rl:test-auth:', { max: 3, skipSuccessfulRequests: true }),
      (_req, res) => res.status(401).json({ success: false }),
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(isolatedApp).post('/login').send({ password: 'wrong' });
      expect(response.status).toBe(401);
    }

    const limited = await request(isolatedApp).post('/login').send({ password: 'wrong' });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMIT_001',
        message: expect.any(String),
      },
    });
  });
});
