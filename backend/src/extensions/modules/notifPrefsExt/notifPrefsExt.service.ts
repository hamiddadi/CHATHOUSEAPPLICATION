import { redis } from '../../../config/redis';

/**
 * Notification preferences extension (Module 12.6 / NOTIF-009/010/012).
 *
 * The existing `NotificationPreference` table only stores boolean toggles
 * per type. This extension adds two complementary axes that Clubhouse
 * exposes :
 *   - **Frequency tier** : infrequent / normal / frequent — clamps how
 *     often we deliver fan-out pushes (room_started_by_following, etc.).
 *   - **Per-club mute** : disable notifications for a specific Club.
 *   - **Per-user mute** : disable for a specific user.
 *
 * Stored in Redis to avoid schema migration on the existing
 * NotificationPreference model.
 */

export type FrequencyTier = 'infrequent' | 'normal' | 'frequent';

const freqKey = (userId: string) => `ext:notif:freq:${userId}`;
const clubMuteKey = (userId: string) => `ext:notif:mute:club:${userId}`;
const userMuteKey = (userId: string) => `ext:notif:mute:user:${userId}`;
const lastDeliveredKey = (userId: string, kind: string) => `ext:notif:lastdel:${kind}:${userId}`;

const FREQ_THROTTLE_MS: Record<FrequencyTier, number> = {
  frequent: 0, // no throttling
  normal: 60 * 60 * 1000, // 1h between same-kind pushes
  infrequent: 24 * 60 * 60 * 1000, // 1 push per day per kind
};

/**
 * Check both mute sets and claim the frequency slot as one Redis operation.
 * Redis serialises Lua execution, so two workers cannot both observe an empty
 * slot and dispatch the same fan-out push concurrently.
 *
 * TIME comes from Redis rather than an application node, avoiding clock skew
 * when the mono-server is scaled later. Legacy timestamp keys without a TTL
 * are repaired by assigning the remaining quiet-window TTL.
 */
const CAN_DELIVER_SCRIPT = `
local actorId = ARGV[1]
local clubId = ARGV[2]
local throttleMs = tonumber(ARGV[3])

if actorId ~= '' and redis.call('SISMEMBER', KEYS[1], actorId) == 1 then
  return 0
end
if clubId ~= '' and redis.call('SISMEMBER', KEYS[2], clubId) == 1 then
  return 0
end
if throttleMs <= 0 then
  return 1
end

local nowParts = redis.call('TIME')
local nowMs = (tonumber(nowParts[1]) * 1000) + math.floor(tonumber(nowParts[2]) / 1000)
local lastRaw = redis.call('GET', KEYS[3])
local lastMs = tonumber(lastRaw)

if lastMs and (nowMs - lastMs) < throttleMs then
  local remainingMs = throttleMs - (nowMs - lastMs)
  if redis.call('PTTL', KEYS[3]) < 0 then
    redis.call('PEXPIRE', KEYS[3], remainingMs)
  end
  return 0
end

redis.call('SET', KEYS[3], tostring(nowMs), 'PX', throttleMs)
return 1
`;

export const notifPrefsExtService = {
  async getFrequency(userId: string): Promise<FrequencyTier> {
    const v = await redis.get(freqKey(userId));
    return v === 'infrequent' || v === 'frequent' ? v : 'normal';
  },

  async setFrequency(userId: string, tier: FrequencyTier): Promise<void> {
    await redis.set(freqKey(userId), tier);
  },

  async listMutedClubs(userId: string): Promise<string[]> {
    return redis.sMembers(clubMuteKey(userId));
  },
  async muteClub(userId: string, clubId: string): Promise<void> {
    await redis.sAdd(clubMuteKey(userId), clubId);
  },
  async unmuteClub(userId: string, clubId: string): Promise<void> {
    await redis.sRem(clubMuteKey(userId), clubId);
  },

  async listMutedUsers(userId: string): Promise<string[]> {
    return redis.sMembers(userMuteKey(userId));
  },
  async muteUser(userId: string, targetId: string): Promise<void> {
    await redis.sAdd(userMuteKey(userId), targetId);
  },
  async unmuteUser(userId: string, targetId: string): Promise<void> {
    await redis.sRem(userMuteKey(userId), targetId);
  },

  /**
   * Returns true if the user is allowed to receive a *push* for the given
   * `kind` right now. Three axes are consulted, cheapest first:
   *   1. **Per-user mute** — the actor is muted ⇒ never push.
   *   2. **Per-club mute** — the originating club is muted ⇒ never push.
   *   3. **Frequency tier** — throttles same-`kind` fan-out pushes.
   *
   * Only the PUSH is gated; callers must still persist the in-app row +
   * realtime emit so the bell stays accurate. Mute is a hard gate (no
   * throttle bookkeeping happens once muted). The throttle "spends" a slot
   * only when it would otherwise allow the push, so a muted club/user never
   * resets a user's quiet window.
   */
  async canDeliver(
    userId: string,
    kind: string,
    opts: { clubId?: string | null; actorId?: string | null } = {},
  ): Promise<boolean> {
    const { clubId, actorId } = opts;
    const tier = await this.getFrequency(userId);
    const throttle = FREQ_THROTTLE_MS[tier];
    const result = await redis.eval(CAN_DELIVER_SCRIPT, {
      keys: [userMuteKey(userId), clubMuteKey(userId), lastDeliveredKey(userId, kind)],
      arguments: [actorId ?? '', clubId ?? '', String(throttle)],
    });
    return Number(result) === 1;
  },
};
