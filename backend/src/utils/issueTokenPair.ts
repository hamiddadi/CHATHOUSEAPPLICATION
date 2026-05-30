import { randomUUID } from 'node:crypto';
import { prisma } from '../config/database';
import { signAccessToken, signRefreshToken } from './jwt';

export const REFRESH_TTL_DAYS = 7;

export const issueTokenPair = async (
  userId: string,
): Promise<{ accessToken: string; refreshToken: string }> => {
  const jti = randomUUID();
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, jti);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({ data: { token: jti, userId, expiresAt } });

  return { accessToken, refreshToken };
};
