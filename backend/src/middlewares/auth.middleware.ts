import { createHash } from 'node:crypto';
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
    /**
     * Platform role resolved during requireAuth. requireRole reuses it to
     * avoid a second identical DB read on the admin surface.
     * TODO(audit): once access tokens carry a jti, this can move into the
     * token instead of a per-request DB lookup.
     */
    appRole?: AppRole;
  }
}

// Index the blacklist by a SHA-256 digest of the token rather than the raw
// JWT. The access token has no jti to key on (only refresh tokens do, see
// jwt.ts), so hashing keeps Redis keys fixed-size and avoids persisting a
// replayable bearer token verbatim in Redis.
// TODO(audit): add a `jti` claim to signAccessToken (jwt.ts/auth.service.ts)
// and blacklist by jti to drop the per-request hashing entirely.
const blacklistKey = (token: string): string =>
  `blacklist:${createHash('sha256').update(token).digest('hex')}`;

// Lockout-propagation window for the suspension cache: how long a cached
// suspended/clear verdict is trusted before requireAuth re-reads the DB.
const SUSPENSION_CACHE_TTL_SECONDS = 60;

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
    // suspend() primes this key to '1' and unsuspend() deletes it, so the
    // 60 s window below only ever applies to suspensions that haven't been
    // propagated yet.
    const cacheKey = `user:susp:${claims.sub}`;
    const cached = await redis.get(cacheKey);
    if (cached === '1') return next(new AppError('AUTH_007'));
    // Re-read the DB on a clean miss (null) OR any unexpected value other
    // than the known '0' marker, so a corrupted/foreign cache entry fails
    // safe (re-verify) instead of silently trusting it.
    if (cached !== '0') {
      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { suspendedUntil: true, appRole: true },
      });
      const isSuspended = Boolean(user?.suspendedUntil && user.suspendedUntil > new Date());
      // Short TTL: a 60 s window between suspension and effective lockout
      // is acceptable, much shorter than the 15-min access-token lifetime.
      await redis.setEx(cacheKey, SUSPENSION_CACHE_TTL_SECONDS, isSuspended ? '1' : '0');
      if (isSuspended) return next(new AppError('AUTH_007'));
      if (user) req.appRole = user.appRole;
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
 * Build a middleware that resolves the caller's appRole and rejects when
 * below the required tier. The role is read per request (not cached in the
 * JWT) so a demotion takes effect immediately — losing godmode access
 * mid-session is too sensitive to wait on token rotation.
 *
 * requireAuth already resolves appRole on the DB-read path and stashes it on
 * `req.appRole`; we reuse that here to avoid a second identical lookup on the
 * admin surface. When it's absent (e.g. requireAuth served the suspension
 * check from cache, or this middleware is used standalone) we fall back to a
 * fresh DB read — the value still stays per-request, never JWT-cached.
 */
export const requireRole = (minimum: AppRole): RequestHandler => {
  const min = ROLE_RANK[minimum];
  return async (req, _res, next) => {
    try {
      if (!req.userId) return next(new AppError('AUTH_003'));
      let appRole = req.appRole;
      if (appRole === undefined) {
        const me = await prisma.user.findUnique({
          where: { id: req.userId },
          select: { appRole: true, suspendedUntil: true },
        });
        if (!me) return next(new AppError('AUTH_003'));
        if (me.suspendedUntil && me.suspendedUntil > new Date()) {
          return next(new AppError('AUTH_007'));
        }
        appRole = me.appRole;
        req.appRole = appRole;
      }
      if (ROLE_RANK[appRole] < min) return next(new AppError('AUTH_008'));
      next();
    } catch (err) {
      next(err);
    }
  };
};

export const requireModerator = requireRole('MODERATOR');
export const requireAdmin = requireRole('ADMIN');
export const requireSuperAdmin = requireRole('SUPER_ADMIN');
