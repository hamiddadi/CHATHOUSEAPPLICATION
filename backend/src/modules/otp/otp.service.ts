import { randomInt, randomUUID } from 'node:crypto';
import { hash, compare } from 'bcrypt';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { sendSms } from '../../config/smsSender';
import { AppError } from '../../middlewares/error.middleware';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import type { SendOtpInput, VerifyOtpInput } from './otp.schema';

const REFRESH_TTL_DAYS = 7;
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

const issueTokenPair = async (userId: string) => {
  const jti = randomUUID();
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, jti);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { token: jti, userId, expiresAt } });
  return { accessToken, refreshToken };
};

export const otpService = {
  async send(input: SendOtpInput): Promise<{ sent: true; expiresIn: number }> {
    const within = await checkAndBumpRateLimit(input.phoneNumber);
    if (!within) throw new AppError('RATE_LIMIT_001');

    // Invalidate any previous unused codes for this phone — only the latest
    // emitted code is valid.
    await prisma.otpCode.updateMany({
      where: { phoneNumber: input.phoneNumber, isUsed: false },
      data: { isUsed: true },
    });

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await hash(code, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);

    await prisma.otpCode.create({
      data: { phoneNumber: input.phoneNumber, codeHash, expiresAt },
    });

    await sendSms(
      { to: input.phoneNumber, body: `Your Chathouse code: ${code}` },
      // Dev hint: the raw code is also logged so you can test without SMS.
      env.NODE_ENV === 'production' ? undefined : { code },
    );
    if (env.NODE_ENV !== 'production') {
      logger.info(`[otp] issued ${code} for ${input.phoneNumber} (ttl ${env.OTP_TTL_MINUTES}m)`);
    }

    return { sent: true, expiresIn: env.OTP_TTL_MINUTES * 60 };
  },

  async verify(input: VerifyOtpInput) {
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
      throw new AppError('AUTH_001', 'Too many attempts — request a new code.');
    }

    const ok = await compare(input.code, record.codeHash);
    if (!ok) {
      await prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError('AUTH_001', 'Invalid code');
    }

    // One-shot: mark consumed before issuing tokens.
    await prisma.otpCode.update({ where: { id: record.id }, data: { isUsed: true } });

    // Find-or-create. New users get a placeholder username they must replace
    // on SetupProfile; frontend routes them there via `isNewUser`.
    let user = await prisma.user.findUnique({ where: { phoneNumber: input.phoneNumber } });
    let isNewUser = false;
    if (!user) {
      user = await prisma.user.create({
        data: { phoneNumber: input.phoneNumber },
      });
      isNewUser = true;
    }

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
  },
};
