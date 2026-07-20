import { prisma, runWriteWithRetry } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { getBlockedIdSet } from '../social/blocks';
import { hasBlockBetween, lockRelationshipUsers } from '../social/relationship-lock';
import { emitUserFollowerCount } from '../../socket/realtime';
import { cursorPage } from '../../utils/paginate';

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
} as const;

const displayName = async (userId: string): Promise<string> => {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, displayName: true },
  });
  return u?.displayName ?? u?.username ?? 'Someone';
};

/**
 * Subset of `ids` that `viewerId` actively follows (ACCEPTED only — a PENDING
 * request to a private account is not yet a follow). One query, no N+1.
 */
const followedSubset = async (viewerId: string, ids: string[]): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const rows = await prisma.follow.findMany({
    where: {
      followerId: viewerId,
      followingId: { in: ids },
      status: 'ACCEPTED',
    },
    select: { followingId: true },
  });
  return new Set(rows.map(r => r.followingId));
};

export const followService = {
  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) throw new AppError('USER_003');

    const result = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          // Follow and block share this canonical row lock. Whichever mutation
          // commits last observes the other's committed state, so a follow can
          // never survive across an already-established block.
          const lockedIds = await lockRelationshipUsers(tx, followerId, followingId);
          if (lockedIds.length !== 2) throw new AppError('USER_001');

          const [follower, target] = await Promise.all([
            tx.user.findFirst({
              where: { id: followerId, deletedAt: null },
              select: { id: true },
            }),
            tx.user.findFirst({
              where: { id: followingId, deletedAt: null },
              select: { id: true, isPrivateAccount: true },
            }),
          ]);
          if (!follower || !target) throw new AppError('USER_001');
          if (await hasBlockBetween(tx, followerId, followingId)) {
            throw new AppError('USER_004', 'A blocked relationship cannot be followed');
          }

          const existing = await tx.follow.findUnique({
            where: { followerId_followingId: { followerId, followingId } },
            select: { status: true },
          });
          if (existing?.status === 'ACCEPTED') {
            return { state: 'accepted-existing' as const, followerCount: null };
          }
          if (existing?.status === 'PENDING') {
            return { state: 'pending-existing' as const, followerCount: null };
          }

          if (target.isPrivateAccount) {
            await tx.follow.create({
              data: { followerId, followingId, status: 'PENDING' },
            });
            return { state: 'pending-created' as const, followerCount: null };
          }

          await tx.follow.create({
            data: { followerId, followingId, status: 'ACCEPTED' },
          });
          await tx.user.update({
            where: { id: followerId },
            data: { followingCount: { increment: 1 } },
          });
          const updatedTarget = await tx.user.update({
            where: { id: followingId },
            data: { followerCount: { increment: 1 } },
            select: { followerCount: true },
          });
          return {
            state: 'accepted-created' as const,
            followerCount: updatedTarget.followerCount,
          };
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );

    if (result.state === 'pending-created') {
      await notificationsService.create({
        userId: followingId,
        actorId: followerId,
        type: 'FOLLOW_REQUEST',
        title: 'Follow request',
        body: `${await displayName(followerId)} requested to follow you`,
        data: { followerId },
        targetId: followerId,
        targetType: 'user',
      });
    }
    if (result.state === 'accepted-created') {
      emitUserFollowerCount(followingId, result.followerCount);
      await notificationsService.create({
        userId: followingId,
        actorId: followerId,
        type: 'NEW_FOLLOWER',
        title: 'New follower',
        body: `${await displayName(followerId)} started following you`,
        data: { followerId },
        targetId: followerId,
        targetType: 'user',
      });
    }

    if (result.state === 'pending-created' || result.state === 'pending-existing') {
      return { following: false as const, requested: true as const };
    }
    return { following: true as const };
  },

  async unfollow(followerId: string, followingId: string) {
    const result = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await lockRelationshipUsers(tx, followerId, followingId);
          // DELETE ... RETURNING the status so counters are only decremented for
          // an edge that was actually counted (ACCEPTED). Cancelling a PENDING
          // request must not touch denormalized counts.
          const removed = await tx.$queryRaw<{ status: 'PENDING' | 'ACCEPTED' }[]>`
      DELETE FROM "Follow"
      WHERE "followerId" = ${followerId} AND "followingId" = ${followingId}
      RETURNING "status"`;
          let followerCount: number | null = null;
          if (removed.some(r => r.status === 'ACCEPTED')) {
            await tx.$executeRaw`UPDATE "User" SET "followingCount" = GREATEST("followingCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${followerId}`;
            const rows = await tx.$queryRaw<
              { followerCount: number }[]
            >`UPDATE "User" SET "followerCount" = GREATEST("followerCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${followingId} RETURNING "followerCount"`;
            followerCount = rows[0]?.followerCount ?? 0;
            await tx.notification.deleteMany({
              where: {
                userId: followingId,
                actorId: followerId,
                type: 'NEW_FOLLOWER',
              },
            });
          } else if (removed.length > 0) {
            await tx.notification.deleteMany({
              where: {
                userId: followingId,
                actorId: followerId,
                type: 'FOLLOW_REQUEST',
              },
            });
          }
          return {
            following: false as const,
            followerCount,
          };
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );
    if (result.followerCount !== null) {
      emitUserFollowerCount(followingId, result.followerCount);
    }
    return { following: result.following };
  },

  /**
   * FOLL-01: the private account accepts a pending request. Promotes the edge to
   * ACCEPTED and counts it (the requester now follows me). Throws USER_001 when
   * there's no matching pending request.
   */
  async acceptFollowRequest(meId: string, requesterId: string) {
    const result = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          const lockedIds = await lockRelationshipUsers(tx, meId, requesterId);
          if (lockedIds.length !== 2) throw new AppError('USER_001');
          const activeUsers = await tx.user.count({
            where: { id: { in: [meId, requesterId] }, deletedAt: null },
          });
          if (activeUsers !== 2) throw new AppError('USER_001');
          if (await hasBlockBetween(tx, meId, requesterId)) {
            throw new AppError('USER_004', 'A blocked follow request cannot be accepted');
          }

          const promoted = await tx.follow.updateMany({
            where: {
              followerId: requesterId,
              followingId: meId,
              status: 'PENDING',
            },
            data: { status: 'ACCEPTED' },
          });

          if (promoted.count === 0) {
            // Idempotent replay: an already accepted edge is success without a
            // second counter bump. A missing edge remains a not-found request.
            const existing = await tx.follow.findFirst({
              where: {
                followerId: requesterId,
                followingId: meId,
                status: 'ACCEPTED',
              },
              select: { id: true },
            });
            if (!existing) throw new AppError('USER_001');
            const me = await tx.user.findUnique({
              where: { id: meId },
              select: { followerCount: true },
            });
            return { changed: false, followerCount: me?.followerCount ?? 0 };
          }

          await tx.user.update({
            where: { id: requesterId },
            data: { followingCount: { increment: 1 } },
          });
          const me = await tx.user.update({
            where: { id: meId },
            data: { followerCount: { increment: 1 } },
            select: { followerCount: true },
          });

          await tx.notification.deleteMany({
            where: {
              userId: meId,
              actorId: requesterId,
              type: 'FOLLOW_REQUEST',
            },
          });
          return { changed: true, followerCount: me.followerCount };
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );
    if (result.changed) emitUserFollowerCount(meId, result.followerCount);
    return { accepted: true as const };
  },

  /** FOLL-01: the private account declines a pending request (just removes it). */
  async rejectFollowRequest(meId: string, requesterId: string) {
    const removed = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await lockRelationshipUsers(tx, meId, requesterId);
          const result = await tx.follow.deleteMany({
            where: {
              followerId: requesterId,
              followingId: meId,
              status: 'PENDING',
            },
          });
          if (result.count > 0) {
            await tx.notification.deleteMany({
              where: {
                userId: meId,
                actorId: requesterId,
                type: 'FOLLOW_REQUEST',
              },
            });
          }
          return result;
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );
    return { rejected: removed.count > 0 };
  },

  /** FOLL-01: pending follow requests TO me (private-account inbox). */
  async listFollowRequests(meId: string, limit = 50, cursor?: string) {
    const rows = await prisma.follow.findMany({
      where: {
        followingId: meId,
        status: 'PENDING',
        follower: { deletedAt: null },
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { follower: { select: publicUser } },
      take: limit + 1,
    });
    return cursorPage(
      rows,
      limit,
      r => r.createdAt.toISOString(),
      r => r.follower,
    );
  },

  async listFollowers(userId: string, viewerId: string, limit = 50, cursor?: string) {
    const blocked = await getBlockedIdSet(viewerId);
    if (userId !== viewerId) {
      const target = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      });
      if (!target || blocked.has(userId)) throw new AppError('USER_001');
    }
    const rows = await prisma.follow.findMany({
      where: {
        followingId: userId,
        status: 'ACCEPTED',
        followerId: { notIn: [...blocked] },
        follower: { deletedAt: null },
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { follower: { select: publicUser } },
      take: limit + 1,
    });
    const page = cursorPage(
      rows,
      limit,
      r => r.createdAt.toISOString(),
      r => r.follower,
    );
    const followed = await followedSubset(
      viewerId,
      page.data.map(u => u.id),
    );
    return {
      ...page,
      data: page.data.map(u => ({
        ...u,
        isFollowedByMe: followed.has(u.id),
      })),
    };
  },

  async listFollowing(userId: string, viewerId: string, limit = 50, cursor?: string) {
    const blocked = await getBlockedIdSet(viewerId);
    if (userId !== viewerId) {
      const target = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      });
      if (!target || blocked.has(userId)) throw new AppError('USER_001');
    }
    const rows = await prisma.follow.findMany({
      where: {
        followerId: userId,
        status: 'ACCEPTED',
        followingId: { notIn: [...blocked] },
        following: { deletedAt: null },
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { following: { select: publicUser } },
      take: limit + 1,
    });
    const page = cursorPage(
      rows,
      limit,
      r => r.createdAt.toISOString(),
      r => r.following,
    );
    const followed = await followedSubset(
      viewerId,
      page.data.map(u => u.id),
    );
    return {
      ...page,
      data: page.data.map(u => ({
        ...u,
        isFollowedByMe: followed.has(u.id),
      })),
    };
  },

  /**
   * Mutual followers: "Followed by X and Y whom you also follow".
   * Returns up to 5 users the viewer follows who also follow the target.
   * Only ACCEPTED edges on both legs count.
   */
  async mutualFollowers(viewerId: string, targetUserId: string, limit = 5) {
    const blocked = await getBlockedIdSet(viewerId);
    const target = await prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true },
    });
    if (!target || blocked.has(targetUserId)) throw new AppError('USER_001');
    const mutuals = await prisma.$queryRaw<
      {
        id: string;
        username: string | null;
        displayName: string | null;
        avatarUrl: string | null;
      }[]
    >`
      SELECT u.id, u.username, u."displayName", u."avatarUrl"
      FROM "Follow" AS vf
      JOIN "Follow" AS tf ON tf."followerId" = vf."followingId" AND tf."followingId" = ${targetUserId}
      JOIN "User" AS u ON u.id = vf."followingId"
      WHERE vf."followerId" = ${viewerId}
        AND vf."followingId" != ${targetUserId}
        AND vf."status" = 'ACCEPTED'
        AND tf."status" = 'ACCEPTED'
        AND u."deletedAt" IS NULL
      LIMIT ${Math.min(limit * 10, 50)}
    `;
    return mutuals.filter(user => !blocked.has(user.id)).slice(0, limit);
  },
};
