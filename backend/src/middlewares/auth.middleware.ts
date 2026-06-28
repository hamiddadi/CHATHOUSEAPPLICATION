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
// Exported so the socket auth layer keys the blacklist identically — otherwise
// a token revoked on HTTP logout would still be accepted over the socket.
export const blacklistKey = (token: string): string =>
  `blacklist:${createHash('sha256').update(token).digest('hex')}`;

// Lockout-propagation window for the suspension cache: how long a cached
// suspended/clear verdict is trusted before requireAuth re-reads the DB.
// Exported so the socket auth layer reuses the SAME window and verdict format
// (`0:<tokenVersion>`), keeping HTTP and realtime revocation in lock-step.
export const SUSPENSION_CACHE_TTL_SECONDS = 60;

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
    // The clean cached verdict is `0:<tokenVersion>` so the cache-hit path can
    // still enforce AUTH-03 (token revocation) without a DB read. A bare legacy
    // '0' or any unexpected value is treated as a miss and re-read, so a
    // corrupted/foreign entry fails safe.
    const cachedTv =
      cached && cached.startsWith('0:') && Number.isInteger(Number(cached.slice(2)))
        ? Number(cached.slice(2))
        : null;
    if (cachedTv !== null) {
      // AUTH-03: reject an access token minted before a cross-device logout /
      // password reset (which bumps the user's tokenVersion + drops this cache).
      if (claims.tv !== undefined && claims.tv !== cachedTv) {
        return next(new AppError('AUTH_004'));
      }
      // appRole stays unset on the cache-hit path (as before); requireRole
      // does its own DB read when it actually needs the role.
    } else {
      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { suspendedUntil: true, appRole: true, tokenVersion: true },
      });
      // A valid JWT for a user that no longer exists (hard-purged) is
      // unauthorized. NOTE: a soft-deleted (deletion-requested) account is
      // deliberately NOT blocked here — it must still reach
      // POST /me/cancel-deletion during the grace period (and GDPR export).
      // MODE-07's "strip powers" intent is enforced in requireRole's deletedAt
      // check; blocking all of requireAuth on bare deletedAt breaks self-cancel.
      if (!user) return next(new AppError('AUTH_003'));
      // AUTH-03: same revocation check against the authoritative DB value.
      if (claims.tv !== undefined && claims.tv !== user.tokenVersion) {
        return next(new AppError('AUTH_004'));
      }
      const now = new Date();
      const suspendedUntil = user.suspendedUntil;
      const isSuspended = suspendedUntil !== null && suspendedUntil > now;
      // MODE-09: cap the cached-verdict TTL at the suspension's remaining time
      // so the '1' marker never outlives the sanction. Otherwise a suspension
      // that expires in 5 s would keep the user locked out for the full 60 s
      // window. Clear verdicts keep the full short TTL.
      const remainingSec =
        suspendedUntil === null
          ? SUSPENSION_CACHE_TTL_SECONDS
          : Math.max(1, Math.ceil((suspendedUntil.getTime() - now.getTime()) / 1000));
      const ttl = isSuspended
        ? Math.min(SUSPENSION_CACHE_TTL_SECONDS, remainingSec)
        : SUSPENSION_CACHE_TTL_SECONDS;
      await redis.setEx(cacheKey, ttl, isSuspended ? '1' : `0:${user.tokenVersion}`);
      if (isSuspended) return next(new AppError('AUTH_007'));
      req.appRole = user.appRole;
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

// AUTH-03: drop the cached suspension/tokenVersion verdict so the next
// requireAuth for this user re-reads the DB and sees the bumped tokenVersion.
// Called after a cross-device logout / password reset bumps User.tokenVersion.
export const invalidateUserAuthCache = async (userId: string): Promise<void> => {
  await redis.del(`user:susp:${userId}`);
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
          select: { appRole: true, suspendedUntil: true, deletedAt: true },
        });
        // MODE-07: a soft-deleted account must not retain moderation powers.
        if (!me || me.deletedAt) return next(new AppError('AUTH_003'));
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
