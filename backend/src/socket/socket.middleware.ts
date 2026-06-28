import type { Socket } from 'socket.io';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { verifyAccessToken } from '../utils/jwt';
import { blacklistKey, SUSPENSION_CACHE_TTL_SECONDS } from '../middlewares/auth.middleware';

export interface AuthedSocketData {
  userId: string;
}

/**
 * Typed accessor for the authenticated user id populated by `socketAuth`.
 * Centralises the `socket.data.userId` cast so handlers don't each redefine
 * a local `me()`/`userId()` helper.
 */
export const getUserId = (socket: Socket): string => (socket.data as AuthedSocketData).userId;

const extractToken = (socket: Socket): string | null => {
  const fromAuth = socket.handshake.auth?.['token'];
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
};

/**
 * Mirrors HTTP `requireAuth`: verifies the JWT and rejects if the token was
 * revoked (blacklisted on HTTP logout). Populates `socket.data.userId` so
 * downstream handlers stay tiny.
 */
export const socketAuth = async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
  try {
    const token = extractToken(socket);
    if (!token) return next(new Error('UNAUTHORIZED'));

    // Use the SAME hashed key the HTTP layer writes on logout — keying by the
    // raw token here never matched, so socket revocation was a no-op.
    const revoked = await redis.get(blacklistKey(token));
    if (revoked) return next(new Error('TOKEN_REVOKED'));

    const claims = verifyAccessToken(token);

    // Mirror HTTP requireAuth (auth.middleware.ts) exactly: enforce suspension
    // AND AUTH-03 token revocation (tokenVersion) over realtime too, sharing the
    // SAME Redis verdict cache + `0:<tokenVersion>` format so suspend()/logout
    // invalidation is common to HTTP and socket. Previously the socket layer
    // skipped the tokenVersion check, so a token revoked by a cross-device
    // logout / password reset stayed valid on the socket until its ~15-min
    // natural expiry.
    const cacheKey = `user:susp:${claims.sub}`;
    const cached = await redis.get(cacheKey);
    if (cached === '1') return next(new Error('ACCOUNT_SUSPENDED'));
    // Clean cached verdict is `0:<tokenVersion>`; a bare legacy '0' or any
    // unexpected value is treated as a miss and re-read, so it fails safe.
    const cachedTv =
      cached && cached.startsWith('0:') && Number.isInteger(Number(cached.slice(2)))
        ? Number(cached.slice(2))
        : null;
    if (cachedTv !== null) {
      if (claims.tv !== undefined && claims.tv !== cachedTv) {
        return next(new Error('TOKEN_REVOKED'));
      }
    } else {
      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { suspendedUntil: true, tokenVersion: true },
      });
      if (!user) return next(new Error('UNAUTHORIZED'));
      if (claims.tv !== undefined && claims.tv !== user.tokenVersion) {
        return next(new Error('TOKEN_REVOKED'));
      }
      const now = new Date();
      const suspendedUntil = user.suspendedUntil;
      const isSuspended = suspendedUntil !== null && suspendedUntil > now;
      // Cap the cached-verdict TTL at the suspension's remaining time so the
      // '1' marker never outlives the sanction (matches requireAuth).
      const remainingSec =
        suspendedUntil === null
          ? SUSPENSION_CACHE_TTL_SECONDS
          : Math.max(1, Math.ceil((suspendedUntil.getTime() - now.getTime()) / 1000));
      const ttl = isSuspended
        ? Math.min(SUSPENSION_CACHE_TTL_SECONDS, remainingSec)
        : SUSPENSION_CACHE_TTL_SECONDS;
      await redis.setEx(cacheKey, ttl, isSuspended ? '1' : `0:${user.tokenVersion}`);
      if (isSuspended) return next(new Error('ACCOUNT_SUSPENDED'));
    }

    (socket.data as AuthedSocketData).userId = claims.sub;
    next();
  } catch {
    next(new Error('UNAUTHORIZED'));
  }
};
