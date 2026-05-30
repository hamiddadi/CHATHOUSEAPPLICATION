import { prisma } from '../../../config/database';

const PUBLIC_USER = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  followerCount: true,
  interests: true,
} as const;

export const suggestionsService = {
  /**
   * Return users to follow ranked by:
   *  1. Shared interests with the caller (Jaccard-ish overlap on interests[])
   *  2. Followed by people the caller already follows ("friends of friends")
   *  3. Trending (high follower count)
   *
   * Excludes: self, already-followed, blocked, soft-deleted.
   */
  async forUser(userId: string, limit = 20) {
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { interests: true },
    });
    if (!me) return [];

    const [following, blocks] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      }),
      prisma.block.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);

    const followingIds = following.map(f => f.followingId);
    const blockedIds = new Set<string>([
      ...blocks.map(b => b.blockerId),
      ...blocks.map(b => b.blockedId),
    ]);
    blockedIds.delete(userId);

    const excludeIds = new Set<string>([userId, ...followingIds, ...Array.from(blockedIds)]);

    // Candidate pool: interest overlap first, then friends-of-friends, then trending.
    const interestMatch = me.interests.length
      ? await prisma.user.findMany({
          where: {
            id: { notIn: Array.from(excludeIds) },
            deletedAt: null,
            interests: { hasSome: me.interests },
          },
          select: PUBLIC_USER,
          orderBy: { followerCount: 'desc' },
          take: limit * 2,
        })
      : [];

    const friendsOfFriends = followingIds.length
      ? await prisma.user.findMany({
          where: {
            id: { notIn: Array.from(excludeIds) },
            deletedAt: null,
            followers: { some: { followerId: { in: followingIds } } },
          },
          select: PUBLIC_USER,
          orderBy: { followerCount: 'desc' },
          take: limit,
        })
      : [];

    const trending = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludeIds) },
        deletedAt: null,
      },
      select: PUBLIC_USER,
      orderBy: { followerCount: 'desc' },
      take: limit,
    });

    const seen = new Set<string>();
    const merged = [...interestMatch, ...friendsOfFriends, ...trending].filter(u => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });

    const scored = merged.map(u => {
      const overlap = me.interests.filter(i => u.interests.includes(i)).length;
      const score =
        overlap * 10 + (followingIds.length ? (friendsOfFriends.includes(u) ? 5 : 0) : 0);
      return { user: u, score, sharedInterests: overlap };
    });

    scored.sort((a, b) => b.score - a.score || b.user.followerCount - a.user.followerCount);

    return scored.slice(0, limit).map(s => ({
      id: s.user.id,
      username: s.user.username,
      displayName: s.user.displayName,
      avatarUrl: s.user.avatarUrl,
      bio: s.user.bio,
      followerCount: s.user.followerCount,
      sharedInterestsCount: s.sharedInterests,
      reason:
        s.sharedInterests > 0
          ? 'shared_interests'
          : friendsOfFriends.includes(s.user)
            ? 'friends_of_friends'
            : 'trending',
    }));
  },
};
