/**
 * Stateless, signed house/club invitation tokens.
 *
 * A token encodes `{ clubId, inviterId, exp }` and looks like
 *   <payload>.<sig>
 * where `<payload>` is base64url(JSON) and `<sig>` is a truncated base64url
 * HMAC-SHA256 over the payload. The signature makes the token UNFORGEABLE: a
 * client can neither mint a token for an arbitrary club nor extend its
 * expiry. Because the club id + expiry travel inside the signed payload there
 * is no server-side row to persist — verification is pure crypto, so no Prisma
 * migration is required.
 *
 * The signing key is derived from `JWT_ACCESS_SECRET` (mirroring the referral
 * invites extension) so no new env var is introduced. A distinct derivation
 * label binds the key to this use, so a house-invite signature can never be
 * confused with a referral-code signature.
 */

import crypto from 'node:crypto';
import { env } from '../../config/env';

/** ~7 days, expressed in milliseconds. */
export const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Dedicated signing key derived from the JWT secret so we never sign with the
// raw token-signing key directly. The label binds the derivation to this use.
const SIGNING_KEY = crypto
  .createHmac('sha256', env.JWT_ACCESS_SECRET)
  .update('chathouse-house-invite-v1')
  .digest();

// Signature length in bytes before base64url. 16 bytes (128 bits) is ample to
// resist forgery while keeping the token short.
const SIG_BYTES = 16;

/** base64url encode (RFC 4648 §5) without padding — URL-path safe. */
const toBase64Url = (input: Buffer | string): string =>
  (Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** base64url decode to a utf8 string; returns null on malformed input. */
const fromBase64UrlString = (input: string): string | null => {
  try {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
};

const signPayload = (payload: string): string =>
  toBase64Url(
    crypto.createHmac('sha256', SIGNING_KEY).update(payload).digest().subarray(0, SIG_BYTES),
  );

interface TokenClaims {
  clubId: string;
  inviterId: string;
  /** Expiry as epoch milliseconds. */
  exp: number;
}

export type VerifyResult =
  | { ok: true; claims: TokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' };

export const clubInviteToken = {
  /**
   * Mint a signed invitation token for `clubId`, attributed to `inviterId`,
   * valid for `ttlMs` (default 7 days). Pure-functional: no I/O.
   */
  sign(clubId: string, inviterId: string, ttlMs: number = INVITE_TOKEN_TTL_MS): string {
    const claims: TokenClaims = { clubId, inviterId, exp: Date.now() + ttlMs };
    const payload = toBase64Url(JSON.stringify(claims));
    return `${payload}.${signPayload(payload)}`;
  },

  /**
   * Verify a token's signature and expiry. Returns the decoded claims on
   * success, or a differentiated failure reason so callers can surface an
   * "expired" vs "invalid" message. A tampered or malformed token is `invalid`;
   * a well-signed but past-`exp` token is `expired`.
   */
  verify(token: string): VerifyResult {
    if (!token) return { ok: false, reason: 'invalid' };
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return { ok: false, reason: 'invalid' };
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = signPayload(payload);

    // Constant-time comparison; bail if lengths differ (timingSafeEqual throws
    // on mismatched buffer lengths).
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'invalid' };
    }

    const json = fromBase64UrlString(payload);
    if (!json) return { ok: false, reason: 'invalid' };
    let claims: TokenClaims;
    try {
      const parsed = JSON.parse(json) as Partial<TokenClaims>;
      if (
        typeof parsed.clubId !== 'string' ||
        typeof parsed.inviterId !== 'string' ||
        typeof parsed.exp !== 'number'
      ) {
        return { ok: false, reason: 'invalid' };
      }
      claims = { clubId: parsed.clubId, inviterId: parsed.inviterId, exp: parsed.exp };
    } catch {
      return { ok: false, reason: 'invalid' };
    }

    if (claims.exp <= Date.now()) return { ok: false, reason: 'expired' };
    return { ok: true, claims };
  },
};
