import { randomInt } from 'node:crypto';
import { hash, compare } from 'bcrypt';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { sendSms } from '../../config/smsSender';
import { AppError } from '../../middlewares/error.middleware';
import { issueTokenPair } from '../../utils/issueTokenPair';
import type { SendOtpInput, VerifyOtpInput } from './otp.schema';

const SALT_ROUNDS = 10; // 10 is fine for a 6-digit space; 12 takes ~300ms

const rateKey = (phone: string): string => `otp:rate:${phone}`;

/**
 * Rate-limit key TTL = 1h. Counter increments per send, capped at
 * OTP_RATE_LIMIT_PER_HOUR. We use INCR + EXPIRE(once) so the window is
 * rolling-ish (first request's TTL applies to the whole window).
 */
const checkAndBumpRateLimit = async (phoneNumber: string): Promise<boolean> => {
  const count = await redis.incr(rateKey(phoneNumber));
  if (count === 1) await redis.expire(rateKey(phoneNumber), 3600);
  return count <= env.OTP_RATE_LIMIT_PER_HOUR;
};

/**
 * Dev/QA test-number allowlist (OTP_TEST_NUMBERS, comma-separated). Entries may
 * be E.164 or bare national digits; matching is digit-suffix so the country
 * code the client prepends is irrelevant ("550728585" matches "+213550728585").
 * Short entries (<6 digits) are dropped to avoid trivial suffix collisions.
 */
const TEST_NUMBER_DIGITS = env.OTP_TEST_NUMBERS.split(',')
  .map(s => s.replace(/\D/g, ''))
  .filter(s => s.length >= 6);

const isTestPhone = (phoneNumber: string): boolean => {
  // HARD prod gate: the bypass is inert in production no matter what's set.
  if (env.NODE_ENV === 'production' || TEST_NUMBER_DIGITS.length === 0) return false;
  const digits = phoneNumber.replace(/\D/g, '');
  return TEST_NUMBER_DIGITS.some(t => digits === t || digits.endsWith(t));
};

/**
 * Find-or-create the user for a verified phone number and mint a token pair.
 * Shared by the normal OTP-verify success path and the dev test-number bypass.
 */
const establishSession = async (phoneNumber: string) => {
  // OTP-01: find-or-create via upsert so two requests racing on a brand-new
  // phone number can't both INSERT and collide on the @unique phoneNumber
  // (which would surface as a 500). New users get a placeholder username they
  // must replace on SetupProfile; frontend routes them there via `isNewUser`.
  const existing = await prisma.user.findUnique({
    where: { phoneNumber },
    select: { id: true },
  });
  const isNewUser = existing === null;
  const user = await prisma.user.upsert({
    where: { phoneNumber },
    create: { phoneNumber },
    update: {},
  });

  const tokens = await issueTokenPair(user.id);
  return {
    session: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    },
    user: {
      id: user.id,
      username: user.username ?? '',
      displayName: user.displayName ?? '',
      phoneNumber: user.phoneNumber ?? '',
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      interests: user.interests,
      hasCompletedOnboarding: user.hasCompletedOnboarding,
      createdAt: user.createdAt.toISOString(),
    },
    isNewUser,
  };
};

export const otpService = {
  async send(input: SendOtpInput): Promise<{ sent: true; expiresIn: number }> {
    // Dev/QA test number: no real SMS, no DB code, no rate limit — the tester
    // just enters OTP_TEST_CODE on the next screen (verified in `verify`).
    if (isTestPhone(input.phoneNumber)) {
      logger.info(
        `[otp] test-number ${input.phoneNumber} — skipping SMS, use code ${env.OTP_TEST_CODE}`,
      );
      return { sent: true, expiresIn: env.OTP_TTL_MINUTES * 60 };
    }

    const within = await checkAndBumpRateLimit(input.phoneNumber);
    if (!within) throw new AppError('RATE_LIMIT_001');

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await hash(code, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);

    // OTP-03: send the SMS BEFORE touching the DB. If delivery fails we throw
    // here, leaving previously-issued codes intact — the user isn't locked out
    // by a phantom unsent code. Only on confirmed delivery do we atomically
    // invalidate old codes and commit the new one (one transaction so a
    // partial state — old codes voided but new code missing — can't happen).
    await sendSms(
      { to: input.phoneNumber, body: `Your Chathouse code: ${code}` },
      // Dev hint: the raw code is also logged so you can test without SMS.
      env.NODE_ENV === 'production' ? undefined : { code },
    );

    await prisma.$transaction([
      // Invalidate any previous unused codes for this phone — only the latest
      // emitted code is valid.
      prisma.otpCode.updateMany({
        where: { phoneNumber: input.phoneNumber, isUsed: false },
        data: { isUsed: true },
      }),
      prisma.otpCode.create({
        data: { phoneNumber: input.phoneNumber, codeHash, expiresAt },
      }),
    ]);
    if (env.NODE_ENV !== 'production') {
      logger.info(`[otp] issued ${code} for ${input.phoneNumber} (ttl ${env.OTP_TTL_MINUTES}m)`);
    }

    return { sent: true, expiresIn: env.OTP_TTL_MINUTES * 60 };
  },

  async verify(input: VerifyOtpInput) {
    // Dev/QA test number: accept the fixed OTP_TEST_CODE and log straight in,
    // bypassing the real code lookup. `isTestPhone` is hard-gated to non-prod.
    if (isTestPhone(input.phoneNumber) && input.code === env.OTP_TEST_CODE) {
      logger.info(`[otp] test-number bypass login for ${input.phoneNumber}`);
      return establishSession(input.phoneNumber);
    }

    const record = await prisma.otpCode.findFirst({
      where: {
        phoneNumber: input.phoneNumber,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new AppError('AUTH_002', 'OTP code expired or not found');
    }

    if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
      await prisma.otpCode.update({ where: { id: record.id }, data: { isUsed: true } });
      // 429 (RATE_LIMIT_001) so the client can distinguish exhausted attempts
      // from an invalid code (AUTH_001/401) and prompt for a new code.
      throw new AppError('RATE_LIMIT_001', 'Too many attempts — request a new code.');
    }

    const ok = await compare(input.code, record.codeHash);
    if (!ok) {
      // OTP-02: atomically increment only while still under the cap and unused.
      // Concurrent wrong guesses can't all read the same stale `attempts` and
      // slip past the ceiling — the `attempts < MAX` guard is evaluated by the
      // DB, so the counter is authoritative under concurrency.
      await prisma.otpCode.updateMany({
        where: { id: record.id, isUsed: false, attempts: { lt: env.OTP_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError('AUTH_001', 'Invalid code');
    }

    // OTP-01: atomic one-shot consumption. Two concurrent verifies with the
    // same valid code both reach here, but only one wins the conditional
    // update (isUsed:false guard) — the loser sees count===0 and is rejected,
    // so a single code never mints two sessions.
    const consumed = await prisma.otpCode.updateMany({
      where: { id: record.id, isUsed: false },
      data: { isUsed: true },
    });
    if (consumed.count !== 1) {
      throw new AppError('AUTH_002', 'OTP code expired or not found');
    }

    return establishSession(input.phoneNumber);
  },
};
