import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';
import {
  assertRoomMetadataAccess,
  roomMetadataAccessWhere,
} from '../../../modules/rooms/rooms.access';

/**
 * "Recently played" — track the last N rooms a user attended so the app
 * can surface a "Resume" or "Recently you were in…" strip.
 *
 * Storage : Redis sorted set keyed by userId, score = visited-at epoch ms,
 * member = roomId. Capped at 30 entries. TTL refreshed on each touch.
 *
 * The frontend hydrates the room metadata by passing the IDs back through
 * the existing rooms endpoint — no new join logic on the server.
 */

const MAX_ENTRIES = 30;
const TTL_S = 60 * 24 * 3600; // 60 days
const key = (userId: string) => `ext:recent:${userId}`;

const TOUCH_SCRIPT = `
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZREMRANGEBYRANK', KEYS[1], 0, -tonumber(ARGV[3]) - 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return redis.call('ZCARD', KEYS[1])
`;

export const recentlyPlayedService = {
  async touch(userId: string, roomId: string): Promise<void> {
    await assertRoomMetadataAccess(roomId, userId);
    const now = Date.now();
    await redis.eval(TOUCH_SCRIPT, {
      keys: [key(userId)],
      arguments: [String(now), roomId, String(MAX_ENTRIES), String(TTL_S)],
    });
  },

  async listIds(userId: string, limit = 20): Promise<string[]> {
    // zRange with REV returns latest first
    const boundedLimit = Math.max(1, Math.min(MAX_ENTRIES, Math.trunc(limit)));
    return redis.zRange(key(userId), 0, boundedLimit - 1, { REV: true });
  },

  /**
   * Hydrated list. Access is re-checked on every read so a stale/arbitrary
   * Redis id cannot reveal private or SOCIAL room metadata.
   */
  async list(userId: string, limit = 20) {
    const ids = await this.listIds(userId, limit);
    if (ids.length === 0) return [];
    const rows = await prisma.room.findMany({
      where: {
        id: { in: ids },
        AND: [roomMetadataAccessWhere(userId)],
      },
      select: {
        id: true,
        title: true,
        isLive: true,
        scheduledFor: true,
        endedAt: true,
        topic: true,
        participantCount: true,
        host: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
    const map = new Map(rows.map(r => [r.id, r]));
    return ids.map(id => map.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  },
};
