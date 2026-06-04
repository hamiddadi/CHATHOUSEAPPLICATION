import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
// Lower the rate-limit cap for this suite so the guard is observable without
// burning 100+ requests.
process.env.OTP_RATE_LIMIT_PER_HOUR = '3';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { redis, connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { logger } = require('../src/config/logger') as typeof import('../src/config/logger');
/* eslint-enable @typescript-eslint/no-require-imports */

// Spy logger to capture the raw OTP (surfaced in dev only). Jest isolates
// this per test, so each send captures its own code without collisions.
const captureOtp = async (fn: () => Promise<void>): Promise<string> => {
  let captured = '';
  const orig = logger.info.bind(logger);
  const spy = jest.spyOn(logger, 'info').mockImplementation(((msg: string) => {
    const m = typeof msg === 'string' ? msg.match(/\[otp\] issued (\d{6})/) : null;
    if (m) captured = m[1] ?? '';
    return orig(msg);
  }) as typeof logger.info);
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return captured;
};

const randomPhone = (): string => `+1415555${Math.floor(1000 + Math.random() * 9000)}`;

describe('OTP flow — send / verify / replay / expired / rate limit', () => {
  let app: Express;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  afterEach(async () => {
    // Clear the rate-limit bucket between tests so each phone starts fresh.
    const keys = await redis.keys('otp:rate:*');
    if (keys.length > 0) await redis.del(keys);
  });

  it('happy path: send → verify → returns tokens + isNewUser=true the first time', async () => {
    const phoneNumber = randomPhone();

    const code = await captureOtp(async () => {
      const send = await request(app).post('/api/auth/send-otp').send({ phoneNumber });
      expect(send.status).toBe(200);
      expect(send.body.data.sent).toBe(true);
    });
    expect(code).toMatch(/^\d{6}$/);

    const verify = await request(app).post('/api/auth/verify-otp').send({ phoneNumber, code });
    expect(verify.status).toBe(200);
    expect(verify.body.data.isNewUser).toBe(true);
    expect(verify.body.data.session.accessToken).toEqual(expect.any(String));
    expect(verify.body.data.session.refreshToken).toEqual(expect.any(String));
    expect(verify.body.data.user.phoneNumber).toBe(phoneNumber);
    createdUserIds.push(verify.body.data.user.id);

    // Same phone → isNewUser=false on next login cycle
    const code2 = await captureOtp(async () => {
      const send = await request(app).post('/api/auth/send-otp').send({ phoneNumber });
      expect(send.status).toBe(200);
    });
    const verify2 = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNumber, code: code2 });
    expect(verify2.body.data.isNewUser).toBe(false);
  });

  it('rejects invalid phoneNumber (VALIDATION_001)', async () => {
    const res = await request(app).post('/api/auth/send-otp').send({ phoneNumber: '0612345678' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  it('rejects wrong code (AUTH_001) and increments attempts', async () => {
    const phoneNumber = randomPhone();
    await captureOtp(async () => {
      await request(app).post('/api/auth/send-otp').send({ phoneNumber });
    });
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ phoneNumber, code: '000000' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_001');
    }
  });

  it('locks after max wrong attempts — next attempt returns RATE_LIMIT_001 (429)', async () => {
    const phoneNumber = randomPhone();
    await captureOtp(async () => {
      await request(app).post('/api/auth/send-otp').send({ phoneNumber });
    });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/verify-otp').send({ phoneNumber, code: '000000' });
    }
    // Once attempts >= OTP_MAX_ATTEMPTS the service marks the code used and
    // returns RATE_LIMIT_001 (429) — deliberately distinct from AUTH_001 (401)
    // so the client can tell "exhausted attempts" from "wrong code" (see
    // otp.service.ts).
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNumber, code: '000000' });
    expect(res.status).toBe(429);
  });

  it('rate-limits to 3 sends/hour (OTP_RATE_LIMIT_PER_HOUR=3 in this suite)', async () => {
    const phoneNumber = randomPhone();
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/auth/send-otp').send({ phoneNumber });
      expect(res.status).toBe(200);
    }
    const blocked = await request(app).post('/api/auth/send-otp').send({ phoneNumber });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMIT_001');
  }, 30_000);

  it('resending a code invalidates the previous one', async () => {
    const phoneNumber = randomPhone();
    const firstCode = await captureOtp(async () => {
      await request(app).post('/api/auth/send-otp').send({ phoneNumber });
    });
    const secondCode = await captureOtp(async () => {
      await request(app).post('/api/auth/send-otp').send({ phoneNumber });
    });
    expect(firstCode).not.toBe(secondCode);

    // The first code must now be invalid (isUsed=true from the re-send).
    const replay = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNumber, code: firstCode });
    expect(replay.status).toBe(401);

    // The second code still works.
    const ok = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNumber, code: secondCode });
    expect(ok.status).toBe(200);
    createdUserIds.push(ok.body.data.user.id);
  });
});
