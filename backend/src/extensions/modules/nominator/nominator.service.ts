import { createHmac } from 'node:crypto';
import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';
import { env } from '../../../config/env';
import { extError } from '../../utils/ExtAppError';
import { notificationsService } from '../../../modules/notifications/notifications.service';

/**
 * Nominator mode (Module 2.8 / PROFIL-008).
 *
 * Reproduces Clubhouse's early-access invitation model:
 *   - Each user starts with N invitations (default 2).
 *   - Sending one consumes the counter, creates an `InvitationRecord`,
 *     and surfaces in the inviter's "people I brought in" history.
 *   - On the invitee side, a notification is emitted prompting them
 *     to follow the inviter back.
 *
 * Storage : Redis.
 *   - ext:nominator:count:<userId>      INT  invitations remaining
 *   - ext:nominator:history:<userId>    LIST history rows (newest first)
 *   - ext:nominator:invited:<phoneHmac> STRING inviter userId (de-dup)
 *
 * The raw phone number (PII) is never used as a Redis key nor stored at
 * rest in the history: the de-dup key is keyed by an HMAC of the number,
 * and history rows keep only a masked display value plus the HMAC for
 * signup matching.
 */

const DEFAULT_QUOTA = 2;
const HISTORY_CAP = 100;

const keyCount = (userId: string) => `ext:nominator:count:${userId}`;
const keyHistory = (userId: string) => `ext:nominator:history:${userId}`;

// Strip formatting characters so an invite and a later signup normalise the
// same raw number identically (otherwise de-dup/match would silently miss).
const normalizePhone = (phone: string): string => phone.replace(/[\s().-]/g, '');

// HMAC the phone so a raw number never lands in a Redis key (PII at rest)
// and is never directly enumerable. Keyed on the server JWT secret.
const phoneHmac = (phone: string): string =>
  createHmac('sha256', env.JWT_ACCESS_SECRET).update(phone).digest('hex');
const keyInvited = (phone: string) => `ext:nominator:invited:${phoneHmac(phone)}`;

// Keep the last 2 digits so the inviter can recognise their own contact,
// but never persist the full number.
const maskPhone = (phone: string): string => {
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 1)}${'*'.repeat(phone.length - 3)}${phone.slice(-2)}`;
};

export interface InvitationRecord {
  id: string;
  /** Masked for display (e.g. "+*******89") — never the raw number. */
  invitedPhone: string;
  /** HMAC of the raw number, used to match on signup without storing PII. */
  invitedPhoneHmac: string;
  invitedName: string;
  acceptedUserId: string | null;
  createdAt: string;
}

// Safely decode a stored history row; corrupt JSON yields null (skipped).
const parseRecord = (s: string): InvitationRecord | null => {
  try {
    return JSON.parse(s) as InvitationRecord;
  } catch {
    return null;
  }
};

export const nominatorService = {
  /** Initialise the counter once (atomic SET NX) so concurrent first reads
   * can't both seed it, then return the current value. */
  async ensureQuota(userId: string): Promise<number> {
    const created = await redis.set(keyCount(userId), String(DEFAULT_QUOTA), { NX: true });
    if (created) return DEFAULT_QUOTA;
    const raw = await redis.get(keyCount(userId));
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  },

  async remaining(userId: string): Promise<number> {
    return this.ensureQuota(userId);
  },

  async grant(userId: string, n: number): Promise<number> {
    await this.ensureQuota(userId);
    // Atomic increment avoids a read-modify-write race with concurrent
    // grant()/invite() calls. Clamp to >= 0 afterwards if we overshot down.
    const next = await redis.incrBy(keyCount(userId), n);
    if (next < 0) {
      await redis.set(keyCount(userId), '0');
      return 0;
    }
    return next;
  },

  async history(userId: string, limit = 50): Promise<InvitationRecord[]> {
    const raw = await redis.lRange(keyHistory(userId), 0, limit - 1);
    return raw.map(parseRecord).filter((r): r is InvitationRecord => r !== null);
  },

  async invite(
    inviterId: string,
    invitedPhone: string,
    invitedName: string,
  ): Promise<{ remaining: number; record: InvitationRecord }> {
    const cleanedPhone = normalizePhone(invitedPhone);
    if (!/^\+\d{6,15}$/.test(cleanedPhone)) {
      throw extError('PAY_INVALID', 'Invalid E.164 phone number');
    }
    await this.ensureQuota(inviterId);

    // De-dup — if the phone is already in any inviter's `invited` map, refuse
    const existing = await redis.get(keyInvited(cleanedPhone));
    if (existing) {
      throw extError('CLUB_REQ_DUPLICATE', 'Phone already invited');
    }

    // Atomically consume one invitation. A non-atomic read-modify-write let
    // two concurrent /invite calls both read the same remaining value and
    // each write remaining-1, over-spending the quota. DECR is atomic; if it
    // drops below zero we compensate (INCR) and reject.
    const newCount = await redis.decr(keyCount(inviterId));
    if (newCount < 0) {
      await redis.incr(keyCount(inviterId));
      throw extError('PAY_INVALID', 'No invitations remaining');
    }

    const record: InvitationRecord = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      invitedPhone: maskPhone(cleanedPhone), // masked — no raw PII at rest
      invitedPhoneHmac: phoneHmac(cleanedPhone),
      invitedName,
      acceptedUserId: null,
      createdAt: new Date().toISOString(),
    };

    await Promise.all([
      redis.lPush(keyHistory(inviterId), JSON.stringify(record)),
      redis.lTrim(keyHistory(inviterId), 0, HISTORY_CAP - 1),
      redis.set(keyInvited(cleanedPhone), inviterId),
    ]);

    return { remaining: newCount, record };
  },

  /**
   * Called by the existing auth flow when a phone-OTP signup completes —
   * matches an incoming user against any pending invitation and patches
   * the inviter's history to mark the conversion.
   */
  async maybeBindOnSignup(
    newUserId: string,
    phoneNumber: string,
  ): Promise<{ inviterId: string } | null> {
    const cleaned = normalizePhone(phoneNumber);
    const inviterId = await redis.get(keyInvited(cleaned));
    if (!inviterId) return null;

    // Patch the inviter's most recent matching record (match on the HMAC,
    // since the stored phone is masked).
    const cleanedHmac = phoneHmac(cleaned);
    const rows = await redis.lRange(keyHistory(inviterId), 0, HISTORY_CAP - 1);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row === undefined) continue;
      const rec = parseRecord(row);
      if (rec === null) continue; // ignore corrupt row
      if (rec.invitedPhoneHmac === cleanedHmac && !rec.acceptedUserId) {
        rec.acceptedUserId = newUserId;
        await redis.lSet(keyHistory(inviterId), i, JSON.stringify(rec));
        break;
      }
    }

    // Notify the inviter that their invitation converted
    try {
      const newUser = await prisma.user.findUnique({
        where: { id: newUserId },
        select: { username: true, displayName: true },
      });
      await notificationsService.create({
        userId: inviterId,
        actorId: newUserId,
        type: 'NEW_FOLLOWER', // closest reusable type — payload disambiguates
        title: `${newUser?.displayName ?? newUser?.username ?? 'Someone'} joined`,
        body: 'Your invitation was accepted',
        data: { kind: 'nominator_accepted', inviteeId: newUserId },
        targetId: newUserId,
        targetType: 'user',
      });
    } catch {
      /* best-effort */
    }
    return { inviterId };
  },
};
