import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';

/**
 * Badges system (Module 2.1 / PROFIL-001/028).
 *
 * The legacy `User` model has no `badges` column. This extension stores
 * a list of granted badges per user in Redis (`ext:badges:<userId>`),
 * plus derives a few badges automatically from existing data on read.
 *
 * Auto-derived badges :
 *   - `verified`    — User.isVerified equivalent on Club ownership
 *   - `top_speaker` — host of 5+ live rooms (computed lazily)
 *   - `early`       — account created in the first 60 days
 *   - `host`        — has hosted at least one room
 *
 * Manual badges (admin grants) are stored in the Redis set and union'd
 * with the derived list.
 */

const manualKey = (userId: string) => `ext:badges:${userId}`;

const ALL_BADGES = [
  'verified',
  'top_speaker',
  'early',
  'host',
  'club_owner',
  'nominator',
  'staff',
] as const;
export type Badge = (typeof ALL_BADGES)[number];

const isKnownBadge = (s: string): s is Badge => (ALL_BADGES as readonly string[]).includes(s);

export const badgesService = {
  async derive(userId: string): Promise<Badge[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, _count: { select: { hostedRooms: true, ownedClubs: true } } },
    });
    if (!user) return [];
    const out: Badge[] = [];
    const ageDays = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 60) out.push('early');
    if (user._count.hostedRooms >= 1) out.push('host');
    if (user._count.hostedRooms >= 5) out.push('top_speaker');
    if (user._count.ownedClubs >= 1) out.push('club_owner');
    return out;
  },

  async list(userId: string): Promise<Badge[]> {
    const [manual, derived] = await Promise.all([
      redis.sMembers(manualKey(userId)),
      this.derive(userId),
    ]);
    const set = new Set<Badge>(derived);
    for (const m of manual) {
      if (isKnownBadge(m)) set.add(m);
    }
    return Array.from(set);
  },

  async grant(targetUserId: string, badge: Badge): Promise<void> {
    if (!isKnownBadge(badge)) return;
    await redis.sAdd(manualKey(targetUserId), badge);
  },

  async revoke(targetUserId: string, badge: Badge): Promise<void> {
    if (!isKnownBadge(badge)) return;
    await redis.sRem(manualKey(targetUserId), badge);
  },
};
