import { randomUUID } from 'node:crypto';
import {
  sign,
  verify,
  decode,
  JsonWebTokenError,
  type JwtPayload,
  type SignOptions,
  type VerifyOptions,
} from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  typ: 'access';
  /**
   * Unique access-token identifier used for immediate Redis revocation.
   * Optional only for rolling compatibility with tokens minted before jti was
   * introduced; every newly-issued access/impersonation token carries one.
   */
  jti?: string;
  /**
   * AUTH-03: the user's `tokenVersion` at mint time. Required on every access
   * token so omission cannot bypass cross-device revocation.
   */
  tv: number;
  /**
   * Recovery sessions are deliberately incapable of using normal application
   * routes. Omitted means a regular active session for rolling compatibility.
   */
  scope?: 'account_recovery';
  /**
   * Impersonation claim — when set, `sub` is the impersonated user but
   * `act.sub` identifies the actual super-admin behind the session.
   * Mirrors RFC 8693 (token exchange) actor claim shape so downstream
   * audit code can show "X acting as Y".
   */
  act?: { sub: string; tv: number };
}

export interface RefreshTokenClaims extends JwtPayload {
  sub: string;
  typ: 'refresh';
  jti: string;
  scope?: 'account_recovery';
}

export type SessionTokenScope = 'active' | 'account_recovery';

const commonSignOpts = {
  algorithm: 'HS256',
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
} as const satisfies Pick<SignOptions, 'algorithm' | 'issuer' | 'audience'>;
const accessSignOpts: SignOptions = {
  ...commonSignOpts,
  expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
};
const refreshSignOpts: SignOptions = {
  ...commonSignOpts,
  expiresIn: env.JWT_REFRESH_TTL as SignOptions['expiresIn'],
};
const strictVerifyOptions: VerifyOptions & { complete?: false } = {
  algorithms: ['HS256'],
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  complete: false,
};
const legacyVerifyOptions: VerifyOptions & { complete?: false } = {
  algorithms: ['HS256'],
  complete: false,
};

const legacyNoIssuerAudienceCutoffMs = env.JWT_LEGACY_NO_ISS_AUD_ACCEPT_UNTIL
  ? Date.parse(env.JWT_LEGACY_NO_ISS_AUD_ACCEPT_UNTIL)
  : null;

const hasOwnClaim = (payload: string | JwtPayload | null, claim: 'iss' | 'aud'): boolean =>
  typeof payload === 'object' &&
  payload !== null &&
  Object.prototype.hasOwnProperty.call(payload, claim);

/**
 * Verify a session token during the bounded issuer/audience rollout.
 *
 * Newly issued tokens always take the strict path. A token containing either
 * `iss` or `aud` also always takes that path, so removing one claim or supplying
 * a wrong value can never downgrade it to legacy validation. Only tokens with
 * both claims absent may use the HS256-only bridge, and only before the
 * operator-provided absolute cutoff.
 */
const verifySessionToken = (token: string, secret: string): string | JwtPayload => {
  const untrustedPayload = decode(token);
  const carriesIssuerOrAudience =
    hasOwnClaim(untrustedPayload, 'iss') || hasOwnClaim(untrustedPayload, 'aud');
  const legacyBridgeActive =
    legacyNoIssuerAudienceCutoffMs !== null && Date.now() < legacyNoIssuerAudienceCutoffMs;

  return verify(
    token,
    secret,
    carriesIssuerOrAudience || !legacyBridgeActive ? strictVerifyOptions : legacyVerifyOptions,
  );
};

export const signAccessToken = (
  userId: string,
  tokenVersion = 0,
  scope: SessionTokenScope = 'active',
): string =>
  sign(
    {
      sub: userId,
      typ: 'access',
      tv: tokenVersion,
      ...(scope === 'account_recovery' ? { scope } : {}),
    },
    env.JWT_ACCESS_SECRET,
    {
      ...accessSignOpts,
      jwtid: randomUUID(),
    },
  );

/**
 * Issue a short-lived access token for an admin impersonating a user.
 * Capped at 15 min — long enough for genuine debugging, short enough that
 * a forgotten session can't linger. The `act.sub` claim is what audit
 * code reads to attribute actions back to the real human.
 */
export const signImpersonationToken = (
  impersonatedUserId: string,
  actorUserId: string,
  impersonatedTokenVersion: number,
  actorTokenVersion: number,
  ttlSeconds = 15 * 60,
): string =>
  sign(
    {
      sub: impersonatedUserId,
      typ: 'access',
      tv: impersonatedTokenVersion,
      act: { sub: actorUserId, tv: actorTokenVersion },
    },
    env.JWT_ACCESS_SECRET,
    { ...commonSignOpts, expiresIn: ttlSeconds, jwtid: randomUUID() },
  );

export const signRefreshToken = (
  userId: string,
  jti: string,
  scope: SessionTokenScope = 'active',
): string =>
  sign(
    {
      sub: userId,
      typ: 'refresh',
      jti,
      ...(scope === 'account_recovery' ? { scope } : {}),
    },
    env.JWT_REFRESH_SECRET,
    refreshSignOpts,
  );

export const verifyAccessToken = (token: string): AccessTokenClaims => {
  const decoded = verifySessionToken(token, env.JWT_ACCESS_SECRET);
  if (
    typeof decoded === 'string' ||
    decoded.typ !== 'access' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.tv !== 'number' ||
    !Number.isInteger(decoded.tv) ||
    decoded.tv < 0 ||
    (decoded.scope !== undefined && decoded.scope !== 'account_recovery') ||
    (decoded.jti !== undefined &&
      (typeof decoded.jti !== 'string' || decoded.jti.length === 0 || decoded.jti.length > 128)) ||
    (decoded.act !== undefined &&
      (typeof decoded.act !== 'object' ||
        decoded.act === null ||
        typeof (decoded.act as { sub?: unknown }).sub !== 'string' ||
        typeof (decoded.act as { tv?: unknown }).tv !== 'number' ||
        !Number.isInteger((decoded.act as { tv: number }).tv) ||
        (decoded.act as { tv: number }).tv < 0)) ||
    (decoded.scope === 'account_recovery' && decoded.act !== undefined)
  ) {
    throw new JsonWebTokenError('Invalid access token');
  }
  return decoded as unknown as AccessTokenClaims;
};

export const verifyRefreshToken = (token: string): RefreshTokenClaims => {
  const decoded = verifySessionToken(token, env.JWT_REFRESH_SECRET);
  if (
    typeof decoded === 'string' ||
    decoded.typ !== 'refresh' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.jti !== 'string' ||
    (decoded.scope !== undefined && decoded.scope !== 'account_recovery')
  ) {
    throw new JsonWebTokenError('Invalid refresh token');
  }
  return decoded as unknown as RefreshTokenClaims;
};

export const decodeTokenTtl = (token: string): number => {
  const decoded = decode(token);
  if (!decoded || typeof decoded === 'string' || !decoded.exp) return 0;
  return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
};
