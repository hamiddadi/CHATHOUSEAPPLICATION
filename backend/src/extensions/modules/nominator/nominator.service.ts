import { createHmac, randomUUID } from 'node:crypto';
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
const PENDING_INVITE_TTL_S = 30 * 24 * 3600;
const HISTORY_TTL_S = 365 * 24 * 3600;

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

const GRANT_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local next = current + tonumber(ARGV[1])
if next < 0 then next = 0 end
redis.call('SET', KEYS[1], tostring(next))
return next
`;

const CLAIM_INVITE_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
local quota = tonumber(redis.call('GET', KEYS[1]) or '0')
if quota <= 0 then return -2 end
local remaining = redis.call('DECR', KEYS[1])
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[3]))
redis.call('LPUSH', KEYS[3], ARGV[2])
redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[4]) - 1)
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5]))
return remaining
`;

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
    // Clamp and increment in one Lua operation. A separate INCR then SET(0)
    // could overwrite a concurrent invitation decrement.
    const next = await redis.eval(GRANT_SCRIPT, {
      keys: [keyCount(userId)],
      arguments: [String(n)],
    });
    return Number(next);
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

    const record: InvitationRecord = {
      id: randomUUID(),
      invitedPhone: maskPhone(cleanedPhone), // masked — no raw PII at rest
      invitedPhoneHmac: phoneHmac(cleanedPhone),
      invitedName,
      acceptedUserId: null,
      createdAt: new Date().toISOString(),
    };

    // Claim the phone, consume quota and append history atomically. This closes
    // both the duplicate-phone race across inviters and partial-write states.
    const claim = Number(
      await redis.eval(CLAIM_INVITE_SCRIPT, {
        keys: [keyCount(inviterId), keyInvited(cleanedPhone), keyHistory(inviterId)],
        arguments: [
          inviterId,
          JSON.stringify(record),
          String(PENDING_INVITE_TTL_S),
          String(HISTORY_CAP),
          String(HISTORY_TTL_S),
        ],
      }),
    );
    if (claim === -1) {
      throw extError('CLUB_REQ_DUPLICATE', 'Phone already invited');
    }
    if (claim === -2) {
      throw extError('PAY_INVALID', 'No invitations remaining');
    }

    return { remaining: claim, record };
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
    // One signup may consume a pending phone invitation only once.
    const inviterId = await redis.getDel(keyInvited(cleaned));
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
        dedupeKey: `nominator-accepted:${inviterId}:${newUserId}`,
      });
    } catch {
      /* best-effort */
    }
    return { inviterId };
  },
};
