import { redis } from '../../../config/redis';

/**
 * Search history (Module 11 / SEARCH-020).
 *
 * Stores the last N queries per user so the search bar can suggest recent
 * searches. Plain Redis LIST keyed by userId; de-dup at write time.
 */

const MAX_ENTRIES = 20;
const TTL_S = 30 * 24 * 3600;
const key = (userId: string) => `ext:searchhist:${userId}`;

const normalize = (q: string): string => q.trim().slice(0, 100);

export const searchHistoryService = {
  async list(userId: string, limit = MAX_ENTRIES): Promise<string[]> {
    return redis.lRange(key(userId), 0, limit - 1);
  },

  async record(userId: string, rawQuery: string): Promise<void> {
    const q = normalize(rawQuery);
    if (q.length === 0) return;
    // Remove existing occurrences (case-insensitive de-dup)
    const current = await redis.lRange(key(userId), 0, MAX_ENTRIES);
    const remaining = current.filter(c => c.toLowerCase() !== q.toLowerCase());
    const next = [q, ...remaining].slice(0, MAX_ENTRIES);
    // Atomic rewrite
    await redis.del(key(userId));
    if (next.length > 0) {
      await redis.rPush(key(userId), next);
      await redis.expire(key(userId), TTL_S);
    }
  },

  async clear(userId: string): Promise<void> {
    await redis.del(key(userId));
  },

  async removeOne(userId: string, query: string): Promise<void> {
    const q = normalize(query);
    if (q.length === 0) return;
    const current = await redis.lRange(key(userId), 0, MAX_ENTRIES);
    const next = current.filter(c => c.toLowerCase() !== q.toLowerCase());
    await redis.del(key(userId));
    if (next.length > 0) {
      await redis.rPush(key(userId), next);
      await redis.expire(key(userId), TTL_S);
    }
  },
};
