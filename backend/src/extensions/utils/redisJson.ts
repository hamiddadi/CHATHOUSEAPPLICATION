import { redis } from '../../config/redis';

/**
 * Generic helpers for the repeated "string key holding a JSON blob" pattern
 * shared by several extension services (profileLinks, roomSettingsExt, …).
 *
 * These replicate EXACTLY the long-hand semantics they replace:
 *  - `readJson` : `redis.get`, return `null` on a miss AND on a JSON.parse
 *    failure (the try/catch swallows malformed payloads rather than throwing).
 *  - `writeJson` : `JSON.stringify` then `redis.setEx` when a positive TTL is
 *    supplied, otherwise a plain `redis.set` (no expiry).
 *
 * They intentionally cover ONLY the get/parse/setEx-or-set shape. List (lRange/
 * rPush) and hash (hGet) access patterns are left to their own modules.
 */

export const readJson = async <T>(key: string): Promise<T | null> => {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const writeJson = async (
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> => {
  const s = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.setEx(key, ttlSeconds, s);
  } else {
    await redis.set(key, s);
  }
};
