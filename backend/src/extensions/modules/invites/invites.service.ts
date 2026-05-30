/**
 * Invite-link generation.
 *
 * Produces a shareable deep link of the form
 *   https://app.chathouse.com/invite/<code>
 * where `<code>` is a base64url-encoded attestation of the inviter's userId.
 *
 * Design notes:
 *  - No Prisma table/column/enum is introduced. The inviter is encoded
 *    directly into the link, so attribution ("who invited whom") can be
 *    recovered at redemption time by decoding the code — no DB write needed.
 *  - The code is deliberately NOT a secret: it only attests the inviter, the
 *    same way a referral link does. It is signed-by-encoding only (base64url),
 *    not authenticated — anyone holding the link learns the inviter id, which
 *    is acceptable for a public "invite a friend" flow. We do NOT embed any
 *    sensitive data beyond the opaque user id.
 *  - `decode()` is provided for a future redemption endpoint; it tolerates
 *    malformed input and returns null rather than throwing.
 */

/** Public base URL for invite deep links (deployment-environment value). */
const INVITE_BASE = 'https://app.chathouse.com';

/** base64url encode (RFC 4648 §5) without padding — URL-path safe. */
const toBase64Url = (input: string): string =>
  Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** base64url decode; returns null on malformed input. */
const fromBase64Url = (input: string): string | null => {
  try {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
};

interface InviteLink {
  url: string;
  code: string;
}

export const invitesService = {
  /**
   * Build the inviter's personal invite link. Pure-functional: derives the
   * code from `userId` with no I/O, so it is cheap and side-effect-free.
   */
  linkFor(userId: string): InviteLink {
    const code = toBase64Url(userId);
    return { code, url: `${INVITE_BASE}/invite/${code}` };
  },

  /**
   * Recover the inviter userId from a link code. Returns null if the code is
   * absent or undecodable. Intended for a future redemption/attribution step.
   */
  inviterFromCode(code: string): string | null {
    if (!code) return null;
    return fromBase64Url(code);
  },
};
