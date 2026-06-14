import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { getBlockedIdSet } from '../social/blocks';
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
    where: { followerId: viewerId, followingId: { in: ids }, status: 'ACCEPTED' },
    select: { followingId: true },
  });
  return new Set(rows.map(r => r.followingId));
};

export const followService = {
  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) throw new AppError('USER_003');

    const target = await prisma.user.findUnique({ where: { id: followingId } });
    if (!target) throw new AppError('USER_001');

    // FOLL-02: respect the block graph (both directions) before any write — a
    // blocked user must not be able to recreate the edge block() wiped or push a
    // notification at someone who blocked them. Mirrors wave()'s USER_004 gate.
    const blocked = await getBlockedIdSet(followerId);
    if (blocked.has(followingId)) throw new AppError('USER_004');

    // FOLL-01: a private account gates the follow behind approval. Create a
    // PENDING request (NO counter bump, NO NEW_FOLLOWER), notify the target with
    // a FOLLOW_REQUEST, and report following:false. A public account follows
    // immediately (ACCEPTED) as before. P2002 = the request/follow already
    // exists → idempotent, skip the notification.
    if (target.isPrivateAccount) {
      let created = true;
      try {
        await prisma.follow.create({ data: { followerId, followingId, status: 'PENDING' } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          created = false;
        } else {
          throw err;
        }
      }
      if (created) {
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
      return { following: false as const, requested: true as const };
    }

    // Public account → immediate follow. Create the ACCEPTED edge AND bump both
    // denormalized counts in one transaction so the relation and the counters
    // can't drift; the counter update RETURNs the new follower count.
    let isNewFollow = true;
    let newFollowerCount = 0;
    try {
      const [, , updatedTarget] = await prisma.$transaction([
        prisma.follow.create({ data: { followerId, followingId } }),
        prisma.user.update({
          where: { id: followerId },
          data: { followingCount: { increment: 1 } },
        }),
        prisma.user.update({
          where: { id: followingId },
          data: { followerCount: { increment: 1 } },
          select: { followerCount: true },
        }),
      ]);
      newFollowerCount = updatedTarget.followerCount;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        isNewFollow = false;
      } else {
        throw err;
      }
    }

    if (isNewFollow) {
      emitUserFollowerCount(followingId, newFollowerCount);
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

    return { following: true as const };
  },

  async unfollow(followerId: string, followingId: string) {
    // DELETE ... RETURNING the status so counters are only decremented for an
    // edge that was actually counted (ACCEPTED). Cancelling a PENDING request
    // must not touch the denormalized counts — they were never incremented.
    const removed = await prisma.$queryRaw<{ status: 'PENDING' | 'ACCEPTED' }[]>`
      DELETE FROM "Follow"
      WHERE "followerId" = ${followerId} AND "followingId" = ${followingId}
      RETURNING "status"`;
    if (removed.some(r => r.status === 'ACCEPTED')) {
      const [, rows] = await prisma.$transaction([
        prisma.$executeRaw`UPDATE "User" SET "followingCount" = GREATEST("followingCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${followerId}`,
        prisma.$queryRaw<
          { followerCount: number }[]
        >`UPDATE "User" SET "followerCount" = GREATEST("followerCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${followingId} RETURNING "followerCount"`,
      ]);
      emitUserFollowerCount(followingId, rows[0]?.followerCount ?? 0);
      // FOLL-05: retract the NEW_FOLLOWER notification so a follow→unfollow→
      // re-follow cycle can't spam the target.
      await prisma.notification.deleteMany({
        where: { userId: followingId, actorId: followerId, type: 'NEW_FOLLOWER' },
      });
    } else if (removed.length > 0) {
      // Cancelled a pending request — drop the FOLLOW_REQUEST notification too.
      await prisma.notification.deleteMany({
        where: { userId: followingId, actorId: followerId, type: 'FOLLOW_REQUEST' },
      });
    }
    return { following: false as const };
  },

  /**
   * FOLL-01: the private account accepts a pending request. Promotes the edge to
   * ACCEPTED and counts it (the requester now follows me). Throws USER_001 when
   * there's no matching pending request.
   */
  async acceptFollowRequest(meId: string, requesterId: string) {
    const promoted = await prisma.follow.updateMany({
      where: { followerId: requesterId, followingId: meId, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    if (promoted.count === 0) throw new AppError('USER_001');
    const [, rows] = await prisma.$transaction([
      prisma.$executeRaw`UPDATE "User" SET "followingCount" = "followingCount" + 1, "updatedAt" = NOW() WHERE id = ${requesterId}`,
      prisma.$queryRaw<
        { followerCount: number }[]
      >`UPDATE "User" SET "followerCount" = "followerCount" + 1, "updatedAt" = NOW() WHERE id = ${meId} RETURNING "followerCount"`,
    ]);
    emitUserFollowerCount(meId, rows[0]?.followerCount ?? 0);
    // Clear the now-handled FOLLOW_REQUEST notification.
    await prisma.notification.deleteMany({
      where: { userId: meId, actorId: requesterId, type: 'FOLLOW_REQUEST' },
    });
    return { accepted: true as const };
  },

  /** FOLL-01: the private account declines a pending request (just removes it). */
  async rejectFollowRequest(meId: string, requesterId: string) {
    const removed = await prisma.follow.deleteMany({
      where: { followerId: requesterId, followingId: meId, status: 'PENDING' },
    });
    if (removed.count > 0) {
      await prisma.notification.deleteMany({
        where: { userId: meId, actorId: requesterId, type: 'FOLLOW_REQUEST' },
      });
    }
    return { rejected: removed.count > 0 };
  },

  /** FOLL-01: pending follow requests TO me (private-account inbox). */
  async listFollowRequests(meId: string, limit = 50, cursor?: string) {
    const rows = await prisma.follow.findMany({
      where: {
        followingId: meId,
        status: 'PENDING',
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
    const rows = await prisma.follow.findMany({
      where: {
        followingId: userId,
        status: 'ACCEPTED',
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
    return { ...page, data: page.data.map(u => ({ ...u, isFollowedByMe: followed.has(u.id) })) };
  },

  async listFollowing(userId: string, viewerId: string, limit = 50, cursor?: string) {
    const rows = await prisma.follow.findMany({
      where: {
        followerId: userId,
        status: 'ACCEPTED',
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
    return { ...page, data: page.data.map(u => ({ ...u, isFollowedByMe: followed.has(u.id) })) };
  },

  /**
   * Mutual followers: "Followed by X and Y whom you also follow".
   * Returns up to 5 users the viewer follows who also follow the target.
   * Only ACCEPTED edges on both legs count.
   */
  async mutualFollowers(viewerId: string, targetUserId: string, limit = 5) {
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
      LIMIT ${limit}
    `;
    return mutuals;
  },
};
