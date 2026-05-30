import { prisma } from '../../../config/database';
import { getBlockedIdSet } from '../../../modules/social/blocks';

const PUBLIC_USER = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  lastSeenAt: true,
  isOnline: true,
  currentRoomId: true,
  allowWaves: true,
  isPrivateAccount: true,
  deletedAt: true,
} as const;

/**
 * "Available to chat" = a user the caller follows who is:
 *  - online OR seen within the last 5 minutes
 *  - not currently in another room
 *  - has allowWaves=true (opted into receiving private-room invites)
 *  - not soft-deleted, not blocked (either direction)
 *  - not a private account unless they follow the caller back (presence of a
 *    private account is only visible to approved/reciprocal connections)
 */
export const presenceService = {
  async availableForUser(userId: string, limit = 30) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);

    const [candidates, blockedIds, reciprocal] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: userId },
        select: {
          following: {
            select: PUBLIC_USER,
          },
        },
        take: 500,
      }),
      getBlockedIdSet(userId),
      // Users who follow the caller back → reciprocal connections allowed to
      // surface even when their account is private.
      prisma.follow.findMany({
        where: { followingId: userId },
        select: { followerId: true },
      }),
    ]);

    const reciprocalIds = new Set(reciprocal.map(f => f.followerId));

    type Candidate = NonNullable<(typeof candidates)[number]['following']>;
    return candidates
      .map(c => c.following)
      .filter((u): u is Candidate => {
        if (!u) return false;
        if (u.deletedAt) return false; // soft-deleted account
        if (blockedIds.has(u.id)) return false; // blocked either direction
        if (u.isPrivateAccount && !reciprocalIds.has(u.id)) return false;
        if (!u.allowWaves) return false;
        if (u.currentRoomId) return false; // already in a room
        const recentlySeen = u.lastSeenAt && u.lastSeenAt > fiveMinAgo;
        return Boolean(u.isOnline || recentlySeen);
      })
      .sort((a, b) => {
        const aLast = a.lastSeenAt?.getTime() ?? 0;
        const bLast = b.lastSeenAt?.getTime() ?? 0;
        return bLast - aLast;
      })
      .slice(0, limit)
      .map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        lastSeenAt: u.lastSeenAt,
        isOnline: u.isOnline,
      }));
  },
};
