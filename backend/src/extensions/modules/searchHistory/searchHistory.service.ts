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

// Keep the read/modify/write cycle inside Redis. The former LRANGE -> DEL ->
// RPUSH sequence could lose a concurrent record or removal.
const RECORD_SCRIPT = `
local current = redis.call('LRANGE', KEYS[1], 0, -1)
local value = ARGV[1]
local needle = ARGV[2]
local maxEntries = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
redis.call('DEL', KEYS[1])
redis.call('RPUSH', KEYS[1], value)
local kept = 1
for _, item in ipairs(current) do
  if kept >= maxEntries then break end
  if string.lower(item) ~= needle then
    redis.call('RPUSH', KEYS[1], item)
    kept = kept + 1
  end
end
redis.call('EXPIRE', KEYS[1], ttl)
return kept
`;

const REMOVE_SCRIPT = `
local current = redis.call('LRANGE', KEYS[1], 0, -1)
local needle = ARGV[1]
local ttl = tonumber(ARGV[2])
redis.call('DEL', KEYS[1])
local kept = 0
for _, item in ipairs(current) do
  if string.lower(item) ~= needle then
    redis.call('RPUSH', KEYS[1], item)
    kept = kept + 1
  end
end
if kept > 0 then redis.call('EXPIRE', KEYS[1], ttl) end
return kept
`;

export const searchHistoryService = {
  async list(userId: string, limit = MAX_ENTRIES): Promise<string[]> {
    const boundedLimit = Math.max(1, Math.min(MAX_ENTRIES, Math.trunc(limit)));
    return redis.lRange(key(userId), 0, boundedLimit - 1);
  },

  async record(userId: string, rawQuery: string): Promise<void> {
    const q = normalize(rawQuery);
    if (q.length === 0) return;
    await redis.eval(RECORD_SCRIPT, {
      keys: [key(userId)],
      arguments: [q, q.toLowerCase(), String(MAX_ENTRIES), String(TTL_S)],
    });
  },

  async clear(userId: string): Promise<void> {
    await redis.del(key(userId));
  },

  async removeOne(userId: string, query: string): Promise<void> {
    const q = normalize(query);
    if (q.length === 0) return;
    await redis.eval(REMOVE_SCRIPT, {
      keys: [key(userId)],
      arguments: [q.toLowerCase(), String(TTL_S)],
    });
  },
};
