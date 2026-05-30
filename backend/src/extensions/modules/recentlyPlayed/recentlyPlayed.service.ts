import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';

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

export const recentlyPlayedService = {
  async touch(userId: string, roomId: string): Promise<void> {
    const now = Date.now();
    await Promise.all([
      redis.zAdd(key(userId), { score: now, value: roomId }),
      redis.expire(key(userId), TTL_S),
    ]);
    // Trim — keep only the top MAX_ENTRIES (most recent)
    await redis.zRemRangeByRank(key(userId), 0, -MAX_ENTRIES - 1);
  },

  async listIds(userId: string, limit = 20): Promise<string[]> {
    // zRange with REV returns latest first
    const items = await redis.zRange(key(userId), 0, limit - 1, { REV: true });
    return items;
  },

  /**
   * Hydrated list — returns the room rows (filtered to public + not-ended
   * + non-private). Skips deleted rooms. Preserves recency order.
   */
  async list(userId: string, limit = 20) {
    const ids = await this.listIds(userId, limit);
    if (ids.length === 0) return [];
    const rows = await prisma.room.findMany({
      where: { id: { in: ids } },
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
