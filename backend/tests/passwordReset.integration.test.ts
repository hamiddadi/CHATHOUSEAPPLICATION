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

  it('does not reveal an existing email when the mail provider fails', async () => {
    const username = `pr_mail_${rand()}`;
    const email = `${username}@test.local`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: 'old-password-123' });
    expect(reg.status).toBe(201);
    createdIds.push(reg.body.data.user.id as string);

    const sendSpy = jest
      .spyOn(mailer, 'sendMail')
      .mockRejectedValueOnce(new Error('simulated provider outage'));
    try {
      const existing = await request(app).post('/api/auth/forgot-password').send({ email });
      const unknown = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: `unknown_${rand()}@test.local` });

      expect(existing.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(existing.body).toEqual(unknown.body);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('keeps the generic response but issues no token or email for inactive accounts', async () => {
    const fixtures: Array<{ id: string; email: string }> = [];
    for (const state of ['deleted', 'suspended'] as const) {
      const username = `pr_${state}_${rand()}`;
      const email = `${username}@test.local`;
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ username, email, password: 'old-password-123' });
      expect(reg.status).toBe(201);
      const id = reg.body.data.user.id as string;
      createdIds.push(id);
      fixtures.push({ id, email });
      await prisma.user.update({
        where: { id },
        data:
          state === 'deleted'
            ? { deletedAt: new Date() }
            : { suspendedUntil: new Date(Date.now() + 60 * 60_000) },
      });
    }

    const sendSpy = jest.spyOn(mailer, 'sendMail').mockResolvedValue(undefined);
    try {
      const unknown = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: `unknown_${rand()}@test.local` });
      expect(unknown.status).toBe(200);

      for (const fixture of fixtures) {
        const blocked = await request(app)
          .post('/api/auth/forgot-password')
          .send({ email: fixture.email });
        expect(blocked.status).toBe(200);
        expect(blocked.body).toEqual(unknown.body);
      }

      expect(sendSpy).not.toHaveBeenCalled();
      expect(
        await prisma.passwordResetToken.count({
          where: { userId: { in: fixtures.map(fixture => fixture.id) } },
        }),
      ).toBe(0);
    } finally {
      sendSpy.mockRestore();
    }
  });

  it('consumes a reset token exactly once under concurrent device retries', async () => {
    const username = `pr_race_${rand()}`;
    const email = `${username}@test.local`;
    const oldPassword = 'old-password-123';
    const newPassword = 'concurrent-new-password-456';

    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: oldPassword });
    expect(reg.status).toBe(201);
    createdIds.push(reg.body.data.user.id as string);

    const token = await captureToken(async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email });
      expect(res.status).toBe(200);
    });
    expect(token).toHaveLength(64);

    const attempts = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app).post('/api/auth/reset-password').send({ token, newPassword }),
      ),
    );
    expect(attempts.map(res => res.status).sort((a, b) => a - b)).toEqual([200, 401]);
    expect(attempts.filter(res => res.status === 401)[0]?.body.error.code).toBe('AUTH_003');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: email, password: newPassword });
    expect(login.status).toBe(200);
  });

  it('does not consume a reset token or change credentials while the account is suspended', async () => {
    const username = `pr_suspended_${rand()}`;
    const email = `${username}@test.local`;
    const oldPassword = 'old-password-123';
    const newPassword = 'must-not-land-456';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: oldPassword });
    expect(reg.status).toBe(201);
    const userId = reg.body.data.user.id as string;
    createdIds.push(userId);

    const token = await captureToken(async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email });
      expect(res.status).toBe(200);
    });
    const tokenRecord = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId, usedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, tokenVersion: true },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { suspendedUntil: new Date(Date.now() + 60 * 60_000) },
    });

    const blocked = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('AUTH_007');
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true, tokenVersion: true },
      }),
    ).resolves.toEqual(before);
    await expect(
      prisma.passwordResetToken.findUniqueOrThrow({
        where: { id: tokenRecord.id },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: null });
  });

  it('does not consume a reset token or change credentials after soft deletion', async () => {
    const username = `pr_deleted_${rand()}`;
    const email = `${username}@test.local`;
    const oldPassword = 'old-password-123';
    const newPassword = 'must-not-land-456';
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ username, email, password: oldPassword });
    expect(reg.status).toBe(201);
    const userId = reg.body.data.user.id as string;
    createdIds.push(userId);

    const token = await captureToken(async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email });
      expect(res.status).toBe(200);
    });
    const tokenRecord = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId, usedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, tokenVersion: true },
    });
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });

    const blocked = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, newPassword });
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('AUTH_003');
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true, tokenVersion: true },
      }),
    ).resolves.toEqual(before);
    await expect(
      prisma.passwordResetToken.findUniqueOrThrow({
        where: { id: tokenRecord.id },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: null });
  });
});
