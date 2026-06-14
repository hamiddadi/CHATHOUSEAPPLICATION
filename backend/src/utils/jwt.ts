import {
  sign,
  verify,
  decode,
  JsonWebTokenError,
  type JwtPayload,
  type SignOptions,
} from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  typ: 'access';
  /**
   * AUTH-03: the user's `tokenVersion` at mint time. requireAuth rejects the
   * token when it no longer matches the user's current version (bumped on
   * cross-device logout / password reset), so a stolen access token can be
   * killed before its 15-min expiry. Optional: impersonation tokens omit it.
   */
  tv?: number;
  /**
   * Impersonation claim — when set, `sub` is the impersonated user but
   * `act.sub` identifies the actual super-admin behind the session.
   * Mirrors RFC 8693 (token exchange) actor claim shape so downstream
   * audit code can show "X acting as Y".
   */
  act?: { sub: string };
}

export interface RefreshTokenClaims extends JwtPayload {
  sub: string;
  typ: 'refresh';
  jti: string;
}

const accessSignOpts: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'] };
const refreshSignOpts: SignOptions = { expiresIn: env.JWT_REFRESH_TTL as SignOptions['expiresIn'] };

export const signAccessToken = (userId: string, tokenVersion = 0): string =>
  sign({ sub: userId, typ: 'access', tv: tokenVersion }, env.JWT_ACCESS_SECRET, accessSignOpts);

/**
 * Issue a short-lived access token for an admin impersonating a user.
 * Capped at 15 min — long enough for genuine debugging, short enough that
 * a forgotten session can't linger. The `act.sub` claim is what audit
 * code reads to attribute actions back to the real human.
 */
export const signImpersonationToken = (
  impersonatedUserId: string,
  actorUserId: string,
  ttlSeconds = 15 * 60,
): string =>
  sign(
    { sub: impersonatedUserId, typ: 'access', act: { sub: actorUserId } },
    env.JWT_ACCESS_SECRET,
    { expiresIn: ttlSeconds },
  );

export const signRefreshToken = (userId: string, jti: string): string =>
  sign({ sub: userId, typ: 'refresh', jti }, env.JWT_REFRESH_SECRET, refreshSignOpts);

export const verifyAccessToken = (token: string): AccessTokenClaims => {
  const decoded = verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === 'string' || decoded.typ !== 'access' || typeof decoded.sub !== 'string') {
    throw new JsonWebTokenError('Invalid access token');
  }
  return decoded as AccessTokenClaims;
};

export const verifyRefreshToken = (token: string): RefreshTokenClaims => {
  const decoded = verify(token, env.JWT_REFRESH_SECRET);
  if (
    typeof decoded === 'string' ||
    decoded.typ !== 'refresh' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.jti !== 'string'
  ) {
    throw new JsonWebTokenError('Invalid refresh token');
  }
  return decoded as RefreshTokenClaims;
};

export const decodeTokenTtl = (token: string): number => {
  const decoded = decode(token);
  if (!decoded || typeof decoded === 'string' || !decoded.exp) return 0;
  return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
};
