import { randomUUID } from 'node:crypto';
import { prisma } from '../config/database';
import { signAccessToken, signRefreshToken } from './jwt';

export const REFRESH_TTL_DAYS = 7;

// AUTH-04: cap concurrent active sessions per user. Without a ceiling, every
// login/refresh leaves a live RefreshToken row forever (until natural expiry),
// so the table grows unbounded and stale sessions never get pruned. When the
// cap is exceeded we revoke the OLDEST active tokens, keeping the most recent
// MAX_ACTIVE_SESSIONS — a freshly logged-in device evicts the stalest one.
const MAX_ACTIVE_SESSIONS = 10;

export const issueTokenPair = async (
  userId: string,
): Promise<{ accessToken: string; refreshToken: string }> => {
  const jti = randomUUID();
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, jti);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({ data: { token: jti, userId, expiresAt } });

  // Prune surplus active sessions: revoke the oldest beyond the cap so the
  // total live count stays bounded. The just-created token (newest) is always
  // retained.
  const active = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    skip: MAX_ACTIVE_SESSIONS,
    select: { id: true },
  });
  if (active.length > 0) {
    await prisma.refreshToken.updateMany({
      where: { id: { in: active.map(t => t.id) } },
      data: { revokedAt: new Date() },
    });
  }

  return { accessToken, refreshToken };
};
