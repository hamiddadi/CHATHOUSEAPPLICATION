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
   * Returns true if the user is allowed to receive a push of the given
   * `kind` right now under their frequency tier. Use from fan-out workers
   * to throttle without removing the in-app notification.
   */
  async canDeliver(userId: string, kind: string): Promise<boolean> {
    const tier = await this.getFrequency(userId);
    const throttle = FREQ_THROTTLE_MS[tier];
    if (throttle === 0) return true;

    const last = await redis.get(lastDeliveredKey(userId, kind));
    if (last) {
      const lastMs = Number(last);
      if (Date.now() - lastMs < throttle) return false;
    }
    await redis.set(lastDeliveredKey(userId, kind), String(Date.now()));
    return true;
  },
};
