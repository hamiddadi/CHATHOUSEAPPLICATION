import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const mailer = require('../src/config/mailer') as typeof import('../src/config/mailer');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

describe('Password reset flow', () => {
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

  // Helper: capture the raw reset token from the outbound email. The service
  // intentionally NEVER logs the raw token (security hardening) — it is
  // delivered solely via email — so we spy on the mailer and pull the 64-char
  // hex token out of the message body.
  const captureToken = async (fn: () => Promise<void>): Promise<string> => {
    let captured = '';
    const spy = jest.spyOn(mailer, 'sendMail').mockImplementation(async mail => {
      const m = mail.text.match(/[a-f0-9]{64}/);
      if (m) captured = m[0];
    });
    try {
      await fn();
    } finally {
      spy.mockRestore();
    }
    return captured;
  };

  it('forgot-password issues a token, reset-password updates the hash, old password fails', async () => {
    const username = `pr_${rand()}`;
    const email = `${username}@test.local`;
    const oldPassword = 'old-password-123';
    const newPassword = 'brand-new-password-456';

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: oldPassword });
    expect(reg.status).toBe(201);
    createdIds.push(reg.body.data.user.id);

    // 1. forgot-password with the real email → 200 + token logged
    const token = await captureToken(async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email });
      expect(res.status).toBe(200);
      expect(res.body.data.ok).toBe(true);
    });
    expect(token.length).toBeGreaterThan(40);

    // 2. forgot-password with an unknown email → also 200 (anti-enumeration)
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'does-not-exist@test.local' });
    expect(unknown.status).toBe(200);

    // 3. reset-password with the token → 200
    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword });
    expect(reset.status).toBe(200);

    // 4. old password no longer works
    const loginOld = await request(app)
      .post('/api/auth/login')
      .send({ identifier: email, password: oldPassword });
    expect(loginOld.status).toBe(401);

    // 5. new password works
    const loginNew = await request(app)
      .post('/api/auth/login')
      .send({ identifier: email, password: newPassword });
    expect(loginNew.status).toBe(200);

    // 6. token is single-use: second reset attempt fails
    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'yet-another-password-789' });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('AUTH_003');
  });

  it('reset-password with a bogus token returns AUTH_003', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(64), newPassword: 'some-valid-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_003');
  });
});
