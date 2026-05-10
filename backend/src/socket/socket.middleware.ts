import type { Socket } from 'socket.io';
import { redis } from '../config/redis';
import { verifyAccessToken } from '../utils/jwt';

export interface AuthedSocketData {
  userId: string;
}

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
    (socket.data as AuthedSocketData).userId = claims.sub;
    next();
  } catch {
    next(new Error('UNAUTHORIZED'));
  }
};
