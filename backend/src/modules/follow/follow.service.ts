import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { emitUserFollowerCount } from '../../socket/realtime';
import { cursorPage } from '../../utils/paginate';

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
} as const;

/** Subset of `ids` that `viewerId` currently follows — one query, no N+1. */
const followedSubset = async (viewerId: string, ids: string[]): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const rows = await prisma.follow.findMany({
    where: { followerId: viewerId, followingId: { in: ids } },
    select: { followingId: true },
  });
  return new Set(rows.map(r => r.followingId));
};

export const followService = {
  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) throw new AppError('USER_003');

    const target = await prisma.user.findUnique({ where: { id: followingId } });
    if (!target) throw new AppError('USER_001');

    let isNewFollow = true;
    try {
      await prisma.follow.create({
        data: { followerId, followingId },
      });
    } catch (err) {
      // Already following — treat as idempotent success and skip the
      // notification so we don't spam the target on duplicate calls.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        isNewFollow = false;
      } else {
        throw err;
      }
    }

    if (isNewFollow) {
      // Update denormalized counts; capture the new follower count so we
      // can broadcast it without a follow-up read.
      const [, updatedTarget] = await prisma.$transaction([
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
      emitUserFollowerCount(followingId, updatedTarget.followerCount);

      // Look up the follower's display info for the notification body.
      const follower = await prisma.user.findUnique({
        where: { id: followerId },
        select: { username: true, displayName: true },
      });
      const handle = follower?.displayName ?? follower?.username ?? 'Someone';
      await notificationsService.create({
        userId: followingId,
        actorId: followerId,
        type: 'NEW_FOLLOWER',
        title: 'New follower',
        body: `${handle} started following you`,
        data: { followerId },
        targetId: followerId,
        targetType: 'user',
      });
    }

    return { following: true };
  },

  async unfollow(followerId: string, followingId: string) {
    const res = await prisma.follow.deleteMany({ where: { followerId, followingId } });
    if (res.count > 0) {
      const [, updatedTarget] = await prisma.$transaction([
        prisma.user.update({
          where: { id: followerId },
          data: { followingCount: { decrement: 1 } },
        }),
        prisma.user.update({
          where: { id: followingId },
          data: { followerCount: { decrement: 1 } },
          select: { followerCount: true },
        }),
      ]);
      emitUserFollowerCount(followingId, updatedTarget.followerCount);
    }
    return { following: false };
  },

  async listFollowers(userId: string, viewerId: string, limit = 50, cursor?: string) {
    const rows = await prisma.follow.findMany({
      where: {
        followingId: userId,
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
    // Stamp the viewer's follow relationship so the client's Follow/Following
    // toggle reflects reality (the public select can't carry this per-viewer flag).
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
   */
  async mutualFollowers(viewerId: string, targetUserId: string, limit = 5) {
    // Users the viewer follows who also follow the target.
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
      LIMIT ${limit}
    `;
    return mutuals;
  },
};
