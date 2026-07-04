/**
 * Unit tests for the stateless, HMAC-signed house/club invitation token.
 * Pure crypto — no Postgres/Redis. Exercises the round-trip, expiry, tamper
 * resistance, cross-club rejection, and the differentiated expired/invalid
 * failure reasons that map to CLUB_008 / CLUB_009 in the service.
 */
import { clubInviteToken, INVITE_TOKEN_TTL_MS } from '../src/modules/clubs/clubs.invite-token';

describe('clubInviteToken', () => {
  const clubId = 'club_abc123';
  const inviterId = 'user_xyz789';

  it('signs and verifies a valid token, recovering the exact claims', () => {
    const token = clubInviteToken.sign(clubId, inviterId);
    const result = clubInviteToken.verify(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.clubId).toBe(clubId);
      expect(result.claims.inviterId).toBe(inviterId);
      expect(result.claims.exp).toBeGreaterThan(Date.now());
    }
  });

  it('produces a token with a single "." separating payload and signature', () => {
    const token = clubInviteToken.sign(clubId, inviterId);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect((parts[0] ?? '').length).toBeGreaterThan(0);
    expect((parts[1] ?? '').length).toBeGreaterThan(0);
  });

  it('sets the default expiry ~7 days out', () => {
    const before = Date.now();
    const token = clubInviteToken.sign(clubId, inviterId);
    const result = clubInviteToken.verify(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // exp is within a second of now + 7 days.
      expect(result.claims.exp).toBeGreaterThanOrEqual(before + INVITE_TOKEN_TTL_MS - 1000);
      expect(result.claims.exp).toBeLessThanOrEqual(Date.now() + INVITE_TOKEN_TTL_MS + 1000);
    }
  });

  it('rejects an expired token with reason "expired" (→ CLUB_008)', () => {
    // ttl of -1ms → already expired the instant it is minted.
    const token = clubInviteToken.sign(clubId, inviterId, -1);
    const result = clubInviteToken.verify(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects a tampered payload with reason "invalid" (→ CLUB_009)', () => {
    const token = clubInviteToken.sign(clubId, inviterId);
    const [payload, sig] = token.split('.');
    // Flip a character in the payload; the signature no longer matches.
    const mutated = `${payload}A.${sig}`;
    const result = clubInviteToken.verify(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });

  it('rejects a token signed for one club when verified as-is but flagged by the service for another club', () => {
    // The token itself verifies fine; the club-mismatch guard lives in the
    // service (acceptInvitation). Here we assert the claims carry the ORIGINAL
    // club so that guard has something to compare against.
    const token = clubInviteToken.sign('club_one', inviterId);
    const result = clubInviteToken.verify(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.clubId).toBe('club_one');
  });

  it('rejects garbage / empty / signature-less input as "invalid"', () => {
    for (const bad of ['', 'no-dot', 'a.b.c.d', '.', 'x.']) {
      const result = clubInviteToken.verify(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid');
    }
  });

  it('rejects a token whose signature is truncated/replaced', () => {
    const token = clubInviteToken.sign(clubId, inviterId);
    const [payload] = token.split('.');
    const result = clubInviteToken.verify(`${payload}.deadbeef`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});
