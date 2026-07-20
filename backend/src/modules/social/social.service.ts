import type { ReportReason } from '@prisma/client';
import { prisma, runWriteWithRetry } from '../../config/database';
import { redis } from '../../config/redis';
import { AppError } from '../../middlewares/error.middleware';
import { emitUserFollowerCount, hideMapUsersFromEachOther } from '../../socket/realtime';
import { notificationsService } from '../notifications/notifications.service';
import { assertRoomMetadataAccess } from '../rooms/rooms.access';
import { getBlockedIdSet } from './blocks';
import { lockRelationshipUsers } from './relationship-lock';
import type { ReportInput, ReportRoomInput } from './social.schema';

// Anti-spam: a reporter can only file one report per target per 24h.
// Server-side dedup is cheap with Redis SET NX EX and avoids a DB row
// per attempted spam without locking the user out of legitimate reports
// on different targets.
const REPORT_COOLDOWN_SECONDS = 24 * 60 * 60;
const reportCooldownKey = (reporterId: string, kind: 'user' | 'room', targetId: string) =>
  `report:${kind}:${reporterId}:${targetId}`;

/**
 * Social "soft actions" — interactions on a user that aren't follows or
 * chat but shape discovery + safety: wave (low-cost ping), block (hard
 * mute), report (moderation queue).
 */

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

// A wave is a 1-per-pair-per-hour ping. Enforced via a Redis bucket so
// the check is O(1) and survives app restarts without an extra DB row.
const WAVE_WINDOW_SECONDS = 60 * 60;
const waveKey = (a: string, b: string) => `wave:${a}:${b}`;

const reasonToEnum = (reason: ReportInput['reason']): ReportReason => {
  switch (reason) {
    case 'spam':
      return 'SPAM';
    case 'harassment':
      return 'HARASSMENT';
    case 'fake_profile':
      return 'FAKE_PROFILE';
    case 'other':
      return 'OTHER';
  }
};

export const socialService = {
  // ──────────────────── Wave ────────────────────
  async wave(senderId: string, targetId: string) {
    if (senderId === targetId) throw new AppError('USER_003');
    const target = await prisma.user.findFirst({
      where: { id: targetId, deletedAt: null },
      select: { id: true, username: true, displayName: true, allowWaves: true },
    });
    if (!target) throw new AppError('USER_001');

    // Respect the recipient's opt-out and the block graph (symmetric).
    if (!target.allowWaves) throw new AppError('USER_006');
    const [blocked, acceptedFollow] = await Promise.all([
      getBlockedIdSet(senderId),
      prisma.follow.findFirst({
        where: {
          followerId: senderId,
          followingId: targetId,
          status: 'ACCEPTED',
        },
        select: { id: true },
      }),
    ]);
    if (blocked.has(targetId)) throw new AppError('USER_004');
    if (!acceptedFollow) throw new AppError('USER_006');

    // Rate-limit: 1 wave per (sender, target) per hour.
    const key = waveKey(senderId, targetId);
    const set = await redis.set(key, '1', {
      EX: WAVE_WINDOW_SECONDS,
      NX: true,
    });
    if (set === null) throw new AppError('USER_005');

    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { username: true, displayName: true },
    });
    const handle = sender?.displayName ?? sender?.username ?? 'Someone';

    try {
      await notificationsService.create({
        userId: targetId,
        type: 'WAVE',
        title: handle,
        body: `${handle} sent you a wave 🌊`,
        data: { waverId: senderId },
      });
    } catch (err) {
      await redis.del(key).catch(() => undefined);
      throw err;
    }
    return { waved: true as const };
  },

  // ──────────────────── Block ────────────────────
  async block(blockerId: string, targetId: string) {
    if (blockerId === targetId) throw new AppError('USER_004');

    // Blocking is a hard break — wipe the follow graph in both directions so
    // neither side keeps a stale relationship. Follow/accept/group admission
    // acquire these same ordered User locks, closing the old race where a
    // stale follow pre-check could recreate an edge just after block committed.
    const counts = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          const lockedIds = await lockRelationshipUsers(tx, blockerId, targetId);
          if (lockedIds.length !== 2) throw new AppError('USER_001');
          const activeUsers = await tx.user.count({
            where: { id: { in: [blockerId, targetId] }, deletedAt: null },
          });
          if (activeUsers !== 2) throw new AppError('USER_001');

          await tx.block.upsert({
            where: { blockerId_blockedId: { blockerId, blockedId: targetId } },
            create: { blockerId, blockedId: targetId },
            update: {},
          });
          const removed = await tx.$queryRaw<
            {
              followerId: string;
              followingId: string;
              status: 'PENDING' | 'ACCEPTED';
            }[]
          >`
        DELETE FROM "Follow"
        WHERE ("followerId" = ${blockerId} AND "followingId" = ${targetId})
           OR ("followerId" = ${targetId} AND "followingId" = ${blockerId})
        RETURNING "followerId", "followingId", "status"`;
          const blockerFollowedTarget = removed.some(
            edge =>
              edge.followerId === blockerId &&
              edge.followingId === targetId &&
              edge.status === 'ACCEPTED',
          );
          const targetFollowedBlocker = removed.some(
            edge =>
              edge.followerId === targetId &&
              edge.followingId === blockerId &&
              edge.status === 'ACCEPTED',
          );

          let targetFollowerCount: number | null = null;
          let blockerFollowerCount: number | null = null;
          if (blockerFollowedTarget) {
            await tx.$executeRaw`UPDATE "User" SET "followingCount" = GREATEST("followingCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${blockerId}`;
            const rows = await tx.$queryRaw<
              { followerCount: number }[]
            >`UPDATE "User" SET "followerCount" = GREATEST("followerCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${targetId} RETURNING "followerCount"`;
            targetFollowerCount = rows[0]?.followerCount ?? 0;
          }
          if (targetFollowedBlocker) {
            await tx.$executeRaw`UPDATE "User" SET "followingCount" = GREATEST("followingCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${targetId}`;
            const rows = await tx.$queryRaw<
              { followerCount: number }[]
            >`UPDATE "User" SET "followerCount" = GREATEST("followerCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${blockerId} RETURNING "followerCount"`;
            blockerFollowerCount = rows[0]?.followerCount ?? 0;
          }

          await tx.notification.deleteMany({
            where: {
              type: { in: ['FOLLOW_REQUEST', 'NEW_FOLLOWER'] },
              OR: [
                { userId: blockerId, actorId: targetId },
                { userId: targetId, actorId: blockerId },
              ],
            },
          });
          return { blockerFollowerCount, targetFollowerCount };
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );

    if (counts.targetFollowerCount !== null) {
      emitUserFollowerCount(targetId, counts.targetFollowerCount);
    }
    if (counts.blockerFollowerCount !== null) {
      emitUserFollowerCount(blockerId, counts.blockerFollowerCount);
    }
    hideMapUsersFromEachOther(blockerId, targetId);
    return { blocked: true as const };
  },

  async unblock(blockerId: string, targetId: string) {
    await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await lockRelationshipUsers(tx, blockerId, targetId);
          await tx.block.deleteMany({
            where: { blockerId, blockedId: targetId },
          });
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );
    return { unblocked: true as const };
  },

  async listBlocked(userId: string) {
    const rows = await prisma.block.findMany({
      where: { blockerId: userId, blocked: { deletedAt: null } },
      include: { blocked: { select: publicUser } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(r => r.blocked);
  },

  // ──────────────────── Report ────────────────────
  async report(reporterId: string, targetId: string, input: ReportInput) {
    if (reporterId === targetId) throw new AppError('USER_003');
    const target = await prisma.user.findFirst({
      where: { id: targetId, deletedAt: null },
    });
    if (!target) throw new AppError('USER_001');

    const cooldownKey = reportCooldownKey(reporterId, 'user', targetId);
    const set = await redis.set(cooldownKey, '1', {
      EX: REPORT_COOLDOWN_SECONDS,
      NX: true,
    });
    if (set === null) throw new AppError('RATE_LIMIT_001');

    try {
      const row = await prisma.report.create({
        data: {
          reporterId,
          targetKind: 'USER',
          reportedId: targetId,
          reason: reasonToEnum(input.reason),
          details: input.details ?? null,
        },
      });
      return { reportId: row.id };
    } catch (err) {
      // Don't lock the reporter out for 24h if the DB write failed — release
      // the cooldown claim so a legitimate retry isn't blocked.
      await redis.del(cooldownKey).catch(() => {});
      throw err;
    }
  },

  async reportRoom(reporterId: string, roomId: string, input: ReportRoomInput) {
    await assertRoomMetadataAccess(roomId, reporterId);

    const cooldownKey = reportCooldownKey(reporterId, 'room', roomId);
    const set = await redis.set(cooldownKey, '1', {
      EX: REPORT_COOLDOWN_SECONDS,
      NX: true,
    });
    if (set === null) throw new AppError('RATE_LIMIT_001');

    try {
      const row = await prisma.report.create({
        data: {
          reporterId,
          targetKind: 'ROOM',
          reportedRoomId: roomId,
          reason: reasonToEnum(input.reason),
          details: input.details ?? null,
        },
      });
      return { reportId: row.id };
    } catch (err) {
      // Release the cooldown claim on a failed DB write so a legitimate retry
      // isn't blocked for 24h.
      await redis.del(cooldownKey).catch(() => {});
      throw err;
    }
  },
};
