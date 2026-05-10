import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppRole } from '@prisma/client';
import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { verifyAccessToken } from '../utils/jwt';
import { AppError } from './error.middleware';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    accessToken?: string;
    /**
     * Set when the current token carries an impersonation claim. The
     * audit log uses this to record "X acting as Y" instead of just Y.
     */
    impersonatorId?: string;
  }
}

const blacklistKey = (token: string): string => `blacklist:${token}`;

/**
 * Verify the bearer access token on every protected route. Supports the
 * Redis blacklist used by `POST /auth/logout` to revoke an unexpired token
 * before its natural expiry.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return next(new AppError('AUTH_003'));
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) return next(new AppError('AUTH_003'));

    const isRevoked = await redis.get(blacklistKey(token));
    if (isRevoked) return next(new AppError('AUTH_004'));

    const claims = verifyAccessToken(token);

    // Suspension check — locked users keep a valid JWT but can't transact.
    // Cached briefly in Redis to avoid a DB round-trip on every request;
    // unsuspend() invalidates the cache.
    const cacheKey = `user:susp:${claims.sub}`;
    const cached = await redis.get(cacheKey);
    if (cached === '1') return next(new AppError('AUTH_007'));
    if (cached === null) {
      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { suspendedUntil: true },
      });
      const isSuspended = Boolean(user?.suspendedUntil && user.suspendedUntil > new Date());
      // Short TTL: a 60 s window between suspension and effective lockout
      // is acceptable, much shorter than the 15-min access-token lifetime.
      await redis.setEx(cacheKey, 60, isSuspended ? '1' : '0');
      if (isSuspended) return next(new AppError('AUTH_007'));
    }

    req.userId = claims.sub;
    req.accessToken = token;
    if (claims.act?.sub) req.impersonatorId = claims.act.sub;
    next();
  } catch (err) {
    next(err);
  }
};

export const revokeAccessToken = async (token: string, ttlSeconds: number): Promise<void> => {
  if (ttlSeconds <= 0) return;
  await redis.setEx(blacklistKey(token), ttlSeconds, '1');
};

export const requireUserId = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.userId) return next(new AppError('AUTH_003'));
  next();
};

// ─── Platform-role gating for the Godmode surface ─────────────────────
// Order: USER < MODERATOR < ADMIN < SUPER_ADMIN. We compare via this ladder
// so a single helper handles "must be at least ADMIN" cleanly.
const ROLE_RANK: Record<AppRole, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

/**
 * Build a middleware that loads the caller's appRole on every request and
 * rejects when below the required tier. We re-read on each call (not cached
 * in the JWT) so a demotion takes effect immediately — losing godmode
 * access mid-session is too sensitive to wait on token rotation.
 */
export const requireRole = (minimum: AppRole): RequestHandler => {
  const min = ROLE_RANK[minimum];
  return async (req, _res, next) => {
    try {
      if (!req.userId) return next(new AppError('AUTH_003'));
      const me = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { appRole: true, suspendedUntil: true },
      });
      if (!me) return next(new AppError('AUTH_003'));
      if (me.suspendedUntil && me.suspendedUntil > new Date()) {
        return next(new AppError('AUTH_007'));
      }
      if (ROLE_RANK[me.appRole] < min) return next(new AppError('AUTH_008'));
      next();
    } catch (err) {
      next(err);
    }
  };
};

export const requireModerator = requireRole('MODERATOR');
export const requireAdmin = requireRole('ADMIN');
export const requireSuperAdmin = requireRole('SUPER_ADMIN');
