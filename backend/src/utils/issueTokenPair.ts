import { randomUUID } from 'node:crypto';
import { prisma, runWriteWithRetry } from '../config/database';
import { AppError } from '../middlewares/error.middleware';
import { resolveAccountSessionScope } from '../modules/auth/account-lifecycle';
import { signAccessToken, signRefreshToken, type SessionTokenScope } from './jwt';

export const REFRESH_TTL_DAYS = 7;

// AUTH-04: cap concurrent active sessions per user. Without a ceiling, every
// login/refresh leaves a live RefreshToken row forever (until natural expiry),
// so the table grows unbounded and stale sessions never get pruned. When the
// cap is exceeded we revoke the OLDEST active tokens, keeping the most recent
// MAX_ACTIVE_SESSIONS — a freshly logged-in device evicts the stalest one.
const MAX_ACTIVE_SESSIONS = 10;

export const issueTokenPair = async (
  userId: string,
  options: { scope?: SessionTokenScope } = {},
): Promise<{ accessToken: string; refreshToken: string; scope: SessionTokenScope }> => {
  const scope = options.scope ?? 'active';
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  const tokenVersion = await runWriteWithRetry(
    () =>
      prisma.$transaction(
        async tx => {
          // Serialize token issuance per account. Without this row lock,
          // concurrent logins can all observe the same active-token set and
          // temporarily exceed MAX_ACTIVE_SESSIONS.
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
          if (locked.length === 0) throw new AppError('AUTH_003');

          // AUTH-03: stamp the current tokenVersion into the access token so
          // logout-all/password reset invalidates earlier access tokens.
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { tokenVersion: true, deletedAt: true, suspendedUntil: true },
          });
          if (!user) throw new AppError('AUTH_003');
          const authoritativeScope = resolveAccountSessionScope({ id: userId, ...user });
          if (authoritativeScope !== scope) throw new AppError('AUTH_003');

          await tx.refreshToken.create({ data: { token: jti, userId, expiresAt } });
          const surplus = await tx.refreshToken.findMany({
            where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: MAX_ACTIVE_SESSIONS,
            select: { id: true },
          });
          if (surplus.length > 0) {
            await tx.refreshToken.updateMany({
              where: { id: { in: surplus.map(token => token.id) } },
              data: { revokedAt: new Date() },
            });
          }
          return user.tokenVersion;
        },
        { maxWait: 30_000, timeout: 30_000 },
      ),
    { attempts: 8, baseDelayMs: 50 },
  );

  return {
    accessToken: signAccessToken(userId, tokenVersion, scope),
    refreshToken: signRefreshToken(userId, jti, scope),
    scope,
  };
};
