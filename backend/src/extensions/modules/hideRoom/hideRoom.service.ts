import { redis } from '../../../config/redis';

/**
 * "Hide this room" persistent list (Module 3.5 / HALL-012..015).
 *
 * Backed by a Redis Sorted Set per user (`ext:hiddenz:<userId>`) where the
 * score is each entry's absolute expiry timestamp (ms). The hide survives
 * app restarts. The frontend filters the feed locally by calling `list()`
 * once and removing matched roomIds.
 *
 * Soft TTL of 30 days — a room hidden a month ago resurfaces, matching
 * Clubhouse's behaviour where "Hide" is a short-term mute, not a hard
 * permanent block.
 *
 * Expiry is enforced with a single O(log N) `zRemRangeByScore` per read
 * instead of one `GET` per member (the previous SET + per-item-key design
 * was O(N) round-trips on every list call).
 *
 * NOTE: uses a new key namespace (`ext:hiddenz:`) so it never collides with
 * the legacy plain-SET key type. Legacy SET entries simply age out via their
 * own item-key TTLs and are not migrated (ephemeral feature data).
 */

const TTL_MS = 30 * 24 * 3600 * 1000;
const zKey = (userId: string) => `ext:hiddenz:${userId}`;

export const hideRoomService = {
  async list(userId: string): Promise<string[]> {
    // Drop anything already expired (single ranged delete), then return the
    // live members — no per-item round-trips.
    await redis.zRemRangeByScore(zKey(userId), 0, Date.now());
    return redis.zRange(zKey(userId), 0, -1);
  },

  async hide(userId: string, roomId: string): Promise<void> {
    await redis.zAdd(zKey(userId), { score: Date.now() + TTL_MS, value: roomId });
  },

  async unhide(userId: string, roomId: string): Promise<void> {
    await redis.zRem(zKey(userId), roomId);
  },

  async cleanupExpired(userId: string): Promise<number> {
    // One ranged delete removes every expired member at once (was an O(N)
    // GET-per-member scan). Returns the number purged.
    return redis.zRemRangeByScore(zKey(userId), 0, Date.now());
  },
};
