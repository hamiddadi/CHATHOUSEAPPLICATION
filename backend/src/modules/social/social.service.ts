import type { ReportReason } from '@prisma/client';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { getBlockedIdSet } from './blocks';
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
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, displayName: true, allowWaves: true },
    });
    if (!target) throw new AppError('USER_001');

    // Respect the recipient's opt-out and the block graph (symmetric).
    if (!target.allowWaves) throw new AppError('USER_006');
    const blocked = await getBlockedIdSet(senderId);
    if (blocked.has(targetId)) throw new AppError('USER_004');

    // Rate-limit: 1 wave per (sender, target) per hour.
    const key = waveKey(senderId, targetId);
    const set = await redis.set(key, '1', { EX: WAVE_WINDOW_SECONDS, NX: true });
    if (set === null) throw new AppError('USER_005');

    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { username: true, displayName: true },
    });
    const handle = sender?.displayName ?? sender?.username ?? 'Someone';

    await notificationsService.create({
      userId: targetId,
      type: 'WAVE',
      title: handle,
      body: `${handle} sent you a wave 🌊`,
      data: { waverId: senderId },
    });
    return { waved: true as const };
  },

  // ──────────────────── Block ────────────────────
  async block(blockerId: string, targetId: string) {
    if (blockerId === targetId) throw new AppError('USER_004');
    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new AppError('USER_001');

    // Blocking is a hard break — wipe the follow graph in both directions so
    // neither side keeps a stale relationship. FOLL-03: do the delete with a
    // single DELETE ... RETURNING INSIDE the transaction and decrement the
    // denormalized counts strictly for the edges THIS call actually removed.
    // Keying off the returned rows (not a pre-read) closes the TOCTOU where a
    // concurrent unfollow would otherwise let us decrement a count for an edge
    // that no longer exists. GREATEST still floors at 0.
    await prisma.$transaction(async tx => {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId: targetId } },
        create: { blockerId, blockedId: targetId },
        update: {},
      });
      const removed = await tx.$queryRaw<{ followerId: string; followingId: string }[]>`
        DELETE FROM "Follow"
        WHERE ("followerId" = ${blockerId} AND "followingId" = ${targetId})
           OR ("followerId" = ${targetId} AND "followingId" = ${blockerId})
        RETURNING "followerId", "followingId"`;
      const blockerFollowedTarget = removed.some(
        e => e.followerId === blockerId && e.followingId === targetId,
      );
      const targetFollowedBlocker = removed.some(
        e => e.followerId === targetId && e.followingId === blockerId,
      );
      if (blockerFollowedTarget) {
        await tx.$executeRaw`UPDATE "User" SET "followingCount" = GREATEST("followingCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${blockerId}`;
        await tx.$executeRaw`UPDATE "User" SET "followerCount" = GREATEST("followerCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${targetId}`;
      }
      if (targetFollowedBlocker) {
        await tx.$executeRaw`UPDATE "User" SET "followingCount" = GREATEST("followingCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${targetId}`;
        await tx.$executeRaw`UPDATE "User" SET "followerCount" = GREATEST("followerCount" - 1, 0), "updatedAt" = NOW() WHERE id = ${blockerId}`;
      }
    });

    return { blocked: true as const };
  },

  async unblock(blockerId: string, targetId: string) {
    await prisma.block.deleteMany({
      where: { blockerId, blockedId: targetId },
    });
    return { unblocked: true as const };
  },

  async listBlocked(userId: string) {
    const rows = await prisma.block.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: publicUser } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(r => r.blocked);
  },

  // ──────────────────── Report ────────────────────
  async report(reporterId: string, targetId: string, input: ReportInput) {
    if (reporterId === targetId) throw new AppError('USER_003');
    const target = await prisma.user.findUnique({ where: { id: targetId } });
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
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!room) throw new AppError('ROOM_001');

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
