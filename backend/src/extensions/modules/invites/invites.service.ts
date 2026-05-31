/**
 * Invite links + redemption (Clubhouse-style referral / virality).
 *
 * A link looks like
 *   https://app.chathouse.com/invite/<payload>.<sig>
 * where `<payload>` is base64url(inviterUserId) and `<sig>` is a truncated
 * base64url HMAC-SHA256 over the payload. The signature makes the inviter id
 * UNFORGEABLE: a client cannot mint a code attributing an arbitrary inviter
 * (which would let it bypass the per-user invite quota). The HMAC key is
 * derived from JWT_ACCESS_SECRET so no new env var is required.
 *
 * Redemption writes `invitedById` on the redeemer (once, only while null →
 * idempotent) and atomically decrements the inviter's `invitesRemaining`
 * quota. When the inviter is out of invites the signup still proceeds, just
 * without attribution.
 */

import crypto from 'node:crypto';
import { prisma } from '../../../config/database';
import { env } from '../../../config/env';

/** Public base URL for invite deep links (deployment-environment value). */
const INVITE_BASE = 'https://app.chathouse.com';

// Dedicated signing key derived from the JWT secret so we never sign with the
// raw token-signing key directly. The label binds the derivation to this use.
const SIGNING_KEY = crypto
  .createHmac('sha256', env.JWT_ACCESS_SECRET)
  .update('chathouse-invite-code-v1')
  .digest();

// Signature length in bytes before base64url. 16 bytes (128 bits) is ample to
// resist forgery while keeping the code short.
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

interface InviteLink {
  url: string;
  code: string;
}

export type RedeemResult =
  | { attributed: true; inviterId: string }
  | { attributed: false; reason: 'invalid' | 'self' | 'already' | 'quota' };

export const invitesService = {
  /**
   * Build the inviter's personal, signed invite link. Pure-functional: derives
   * the code from `userId` with no I/O, so it is cheap and side-effect-free.
   */
  linkFor(userId: string): InviteLink {
    const payload = toBase64Url(userId);
    const code = `${payload}.${signPayload(payload)}`;
    return { code, url: `${INVITE_BASE}/invite/${code}` };
  },

  /**
   * Recover and VERIFY the inviter userId from a link code. Returns null if the
   * code is malformed or the signature doesn't match (forged / tampered).
   */
  inviterFromCode(code: string): string | null {
    if (!code) return null;
    const dot = code.lastIndexOf('.');
    if (dot <= 0) return null; // no signature segment → reject (legacy/forged)
    const payload = code.slice(0, dot);
    const sig = code.slice(dot + 1);
    const expected = signPayload(payload);
    // Constant-time comparison; bail if lengths differ (timingSafeEqual throws
    // on mismatched buffer lengths).
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return fromBase64UrlString(payload);
  },

  /**
   * Redeem an invite code for the freshly-onboarded `redeemerId`. Idempotent
   * and quota-safe. Never throws on the normal "couldn't attribute" paths — it
   * returns a structured reason so the caller can proceed regardless.
   */
  async redeem(redeemerId: string, code: string): Promise<RedeemResult> {
    const inviterId = this.inviterFromCode(code);
    if (!inviterId) return { attributed: false, reason: 'invalid' };
    if (inviterId === redeemerId) return { attributed: false, reason: 'self' };

    try {
      return await prisma.$transaction(async tx => {
        // Consume one invite from the inviter — only if they still have quota.
        // updateMany with a guarded WHERE makes this atomic (no read-modify-write
        // race). count 0 ⇒ inviter missing or out of invites.
        const consumed = await tx.user.updateMany({
          where: { id: inviterId, invitesRemaining: { gt: 0 } },
          data: { invitesRemaining: { decrement: 1 } },
        });
        if (consumed.count === 0) return { attributed: false, reason: 'quota' as const };

        // Claim the redeemer's attribution slot, but only while it's still null
        // (idempotent: a second redemption finds it already set → count 0).
        const claimed = await tx.user.updateMany({
          where: { id: redeemerId, invitedById: null },
          data: { invitedById: inviterId },
        });
        if (claimed.count === 0) {
          // Already attributed (or redeemer gone): roll back the decrement by
          // aborting the transaction.
          throw new Error('REDEEM_ALREADY');
        }
        return { attributed: true as const, inviterId };
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'REDEEM_ALREADY') {
        return { attributed: false, reason: 'already' };
      }
      throw err;
    }
  },

  /** Remaining invite quota for a user (for the "invite a friend" UI). */
  async invitesRemaining(userId: string): Promise<number> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { invitesRemaining: true },
    });
    return u?.invitesRemaining ?? 0;
  },
};
