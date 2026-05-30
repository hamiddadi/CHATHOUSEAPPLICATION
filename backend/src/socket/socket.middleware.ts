import type { Socket } from 'socket.io';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { verifyAccessToken } from '../utils/jwt';

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

    const revoked = await redis.get(`blacklist:${token}`);
    if (revoked) return next(new Error('TOKEN_REVOKED'));

    const claims = verifyAccessToken(token);

    // Mirror HTTP requireAuth: a suspended user keeps a valid JWT for up to
    // 15 min but must NOT be able to transact over realtime either (join
    // rooms, publish audio, chat, broadcast location). Same short-TTL Redis
    // cache as the HTTP path so unsuspend() invalidation is shared.
    const cacheKey = `user:susp:${claims.sub}`;
    const cached = await redis.get(cacheKey);
    if (cached === '1') return next(new Error('ACCOUNT_SUSPENDED'));
    if (cached === null) {
      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { suspendedUntil: true },
      });
      const isSuspended = Boolean(user?.suspendedUntil && user.suspendedUntil > new Date());
      await redis.setEx(cacheKey, 60, isSuspended ? '1' : '0');
      if (isSuspended) return next(new Error('ACCOUNT_SUSPENDED'));
    }

    (socket.data as AuthedSocketData).userId = claims.sub;
    next();
  } catch {
    next(new Error('UNAUTHORIZED'));
  }
};
