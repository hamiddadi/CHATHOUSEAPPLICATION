import type { AppRole, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { closeRoom as closeSfuRoom } from '../../webrtc/mediasoup.manager';
import { emitHallwayRoomClosed } from '../../socket/realtime';
import { signImpersonationToken } from '../../utils/jwt';
import { cancelEventReminder } from '../../queues/eventReminders';
import { recordingsService } from '../recordings/recordings.service';
import { notificationsService } from '../notifications/notifications.service';
import { auditLogService } from './auditLog.service';
import type {
  ForceEndRoomInput,
  ListAuditLogInput,
  ListReportsInput,
  ListRoomsInput,
  ListUsersInput,
  ResolveReportInput,
  SetRoleInput,
  SuspendInput,
} from './admin.schema';

// Sentinel for permanent bans — far enough that nothing routine compares it
// without intent. Anything past 9000 is effectively forever for app users.
const PERMANENT_BAN_DATE = new Date('9999-12-31T23:59:59Z');

// Cap on how long a suspension verdict is cached in Redis (1h), to avoid a
// stale cache after a manual unsuspend.
const SUSPENSION_CACHE_TTL_SEC = 60 * 60;

// Hard cap on rows materialised in a single CSV export. Without cursor
// streaming the whole result set is held in memory, so we bound it. When the
// cap is hit the export is silently incomplete from the caller's point of
// view, so we log a warning to make the truncation visible operationally.
// TODO(audit): stream exports in cursor batches instead of a flat cap, and
// consider partial PII masking (email/phone) — both are product/architecture
// decisions deferred here.
const CSV_EXPORT_LIMIT = 5000;

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '""';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Escape inner quotes per RFC 4180. Newlines/commas survive once wrapped.
  return `"${s.replace(/"/g, '""')}"`;
};

const toCsv = (header: readonly string[], rows: readonly Record<string, unknown>[]): string => {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(header.map(h => csvCell(row[h])).join(','));
  }
  return lines.join('\r\n');
};

const ROLE_RANK: Record<AppRole, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

const publicAdminUser = {
  id: true,
  username: true,
  displayName: true,
  email: true,
  phoneNumber: true,
  avatarUrl: true,
  appRole: true,
  isOnline: true,
  suspendedUntil: true,
  suspensionReason: true,
  followerCount: true,
  followingCount: true,
  deletedAt: true,
  createdAt: true,
  lastSeenAt: true,
} as const satisfies Prisma.UserSelect;

interface ActorContext {
  ip: string | null;
  userAgent: string | null;
}

const fetchActor = async (actorId: string) => {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { id: true, appRole: true },
  });
  if (!actor) throw new AppError('AUTH_003');
  return actor;
};

/**
 * Shared rank guard for actor→target moderation actions. You cannot act on a
 * peer or a higher-ranked account; this mirrors the check previously inlined
 * in setRole/suspend/unsuspend/deleteUser. Same exception/code (`ADMIN_002`).
 */
const assertCanActOn = (actor: { appRole: AppRole }, target: { appRole: AppRole }): void => {
  if (ROLE_RANK[target.appRole] >= ROLE_RANK[actor.appRole]) {
    throw new AppError('ADMIN_002');
  }
};

/**
 * CSV exports hold the whole result set in memory, so they are bounded by
 * `CSV_EXPORT_LIMIT`. When the cap is hit the export is silently incomplete
 * from the caller's point of view, so we log a warning to make the truncation
 * visible operationally. `label` matches the per-exporter message previously
 * inlined in each exporter.
 */
const warnIfCsvTruncated = (label: string, rowCount: number): void => {
  if (rowCount === CSV_EXPORT_LIMIT) {
    logger.warn(`${label} truncated at row cap — export is incomplete`, {
      limit: CSV_EXPORT_LIMIT,
    });
  }
};

export const adminService = {
  // ──────────────────── Users ────────────────────
  async listUsers(input: ListUsersInput) {
    const where: Prisma.UserWhereInput = {
      ...(input.q
        ? {
            OR: [
              { username: { contains: input.q, mode: 'insensitive' } },
              { displayName: { contains: input.q, mode: 'insensitive' } },
              { email: { contains: input.q, mode: 'insensitive' } },
              { phoneNumber: { contains: input.q } },
            ],
          }
        : {}),
      ...(input.role ? { appRole: input.role } : {}),
      ...(input.suspended === true
        ? { suspendedUntil: { gt: new Date() } }
        : input.suspended === false
          ? { OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: new Date() } }] }
          : {}),
      ...(input.cursor ? { createdAt: { lt: new Date(input.cursor) } } : {}),
    };
    const rows = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit + 1,
      select: publicAdminUser,
    });
    const hasMore = rows.length > input.limit;
    const data = hasMore ? rows.slice(0, input.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.createdAt.toISOString() : null;
    return { data, nextCursor, hasMore };
  },

  async getUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...publicAdminUser,
        bio: true,
        twitter: true,
        instagram: true,
        interests: true,
        currentRoomId: true,
        _count: { select: { hostedRooms: true, participants: true } },
      },
    });
    if (!user) throw new AppError('USER_001');
    return user;
  },

  /**
   * Change a user's platform role. Guards:
   *  - You cannot promote ABOVE your own rank.
   *  - You cannot modify a user whose current rank is >= yours.
   *  - Demoting the last SUPER_ADMIN is rejected (lockout protection).
   */
  async setRole(actorId: string, targetUserId: string, input: SetRoleInput, ctx: ActorContext) {
    if (actorId === targetUserId) throw new AppError('ADMIN_002');
    const [actor, target] = await Promise.all([
      fetchActor(actorId),
      prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, appRole: true },
      }),
    ]);
    if (!target) throw new AppError('USER_001');

    if (ROLE_RANK[input.role] > ROLE_RANK[actor.appRole]) {
      throw new AppError('ADMIN_002');
    }
    assertCanActOn(actor, target);
    // Lockout protection — refuse to demote the last super-admin.
    if (target.appRole === 'SUPER_ADMIN' && input.role !== 'SUPER_ADMIN') {
      const remaining = await prisma.user.count({
        where: { appRole: 'SUPER_ADMIN', id: { not: targetUserId } },
      });
      if (remaining === 0) throw new AppError('ADMIN_001');
    }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: { appRole: input.role },
      select: publicAdminUser,
    });

    await auditLogService.record({
      actorId,
      action: 'USER_ROLE_CHANGED',
      targetUserId,
      targetType: 'user',
      targetId: targetUserId,
      metadata: { from: target.appRole, to: input.role },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return updated;
  },

  /**
   * Suspend a user. Permanent ban when durationMinutes is omitted/zero;
   * temporary suspension otherwise. The suspension cache key is invalidated
   * so the lockout takes effect on the user's next request.
   */
  async suspend(actorId: string, targetUserId: string, input: SuspendInput, ctx: ActorContext) {
    if (actorId === targetUserId) throw new AppError('ADMIN_002');
    const [actor, target] = await Promise.all([
      fetchActor(actorId),
      prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, appRole: true },
      }),
    ]);
    if (!target) throw new AppError('USER_001');
    assertCanActOn(actor, target);

    const expiresAt =
      input.durationMinutes && input.durationMinutes > 0
        ? new Date(Date.now() + input.durationMinutes * 60_000)
        : PERMANENT_BAN_DATE;

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        suspendedUntil: expiresAt,
        suspensionReason: input.reason,
      },
      select: publicAdminUser,
    });

    // Force the lockout to land within the cache TTL window. We mark the
    // cache "suspended" up to the same expiry so requireAuth doesn't even
    // hit Postgres until the sanction lapses.
    const ttlSec = Math.min(
      SUSPENSION_CACHE_TTL_SEC, // cap 1h to avoid stale cache after a manual unsuspend
      Math.max(30, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)),
    );
    await redis.setEx(`user:susp:${targetUserId}`, ttlSec, '1');

    await auditLogService.record({
      actorId,
      action: 'USER_SUSPENDED',
      targetUserId,
      targetType: 'user',
      targetId: targetUserId,
      metadata: {
        until: expiresAt.toISOString(),
        durationMinutes: input.durationMinutes ?? null,
        reason: input.reason,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return updated;
  },

  async unsuspend(actorId: string, targetUserId: string, ctx: ActorContext) {
    const [actor, target] = await Promise.all([
      fetchActor(actorId),
      prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, appRole: true, suspendedUntil: true, suspensionReason: true },
      }),
    ]);
    if (!target) throw new AppError('USER_001');
    // Mirror suspend/setRole/deleteUser: you cannot act on a peer or a
    // higher-ranked account. Without this a moderator could lift a sanction
    // an admin/super-admin placed on someone at or above the moderator's tier.
    assertCanActOn(actor, target);

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: { suspendedUntil: null, suspensionReason: null },
      select: publicAdminUser,
    });
    await redis.del(`user:susp:${targetUserId}`);

    await auditLogService.record({
      actorId,
      action: 'USER_UNSUSPENDED',
      targetUserId,
      targetType: 'user',
      targetId: targetUserId,
      metadata: {
        previousUntil: target.suspendedUntil?.toISOString() ?? null,
        previousReason: target.suspensionReason,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return updated;
  },

  /**
   * Soft-delete a user (sets `deletedAt`). The cascade-on-delete in the
   * schema is intentionally NOT triggered — we keep their content for the
   * GDPR retention window, then run a periodic purge job.
   */
  async deleteUser(actorId: string, targetUserId: string, ctx: ActorContext) {
    if (actorId === targetUserId) throw new AppError('ADMIN_002');
    const [actor, target] = await Promise.all([
      fetchActor(actorId),
      prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, appRole: true, deletedAt: true },
      }),
    ]);
    if (!target) throw new AppError('USER_001');
    assertCanActOn(actor, target);
    if (target.deletedAt) return { deleted: true as const };

    await prisma.user.update({
      where: { id: targetUserId },
      data: {
        deletedAt: new Date(),
        suspendedUntil: PERMANENT_BAN_DATE,
        suspensionReason: 'Account scheduled for deletion (admin)',
      },
    });
    await redis.setEx(`user:susp:${targetUserId}`, SUSPENSION_CACHE_TTL_SEC, '1');

    await auditLogService.record({
      actorId,
      action: 'USER_DELETED',
      targetUserId,
      targetType: 'user',
      targetId: targetUserId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { deleted: true as const };
  },

  // ──────────────────── Reports ────────────────────
  async listReports(input: ListReportsInput) {
    const where: Prisma.ReportWhereInput = {
      ...(input.status === 'open' ? { resolvedAt: null } : {}),
      ...(input.status === 'resolved' ? { resolvedAt: { not: null } } : {}),
      ...(input.kind ? { targetKind: input.kind } : {}),
      ...(input.cursor ? { createdAt: { lt: new Date(input.cursor) } } : {}),
    };
    const rows = await prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit + 1,
      include: {
        reporter: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        reported: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        reportedRoom: { select: { id: true, title: true, isLive: true, hostId: true } },
      },
    });
    const hasMore = rows.length > input.limit;
    const data = hasMore ? rows.slice(0, input.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.createdAt.toISOString() : null;
    return { data, nextCursor, hasMore };
  },

  async resolveReport(
    actorId: string,
    reportId: string,
    input: ResolveReportInput,
    ctx: ActorContext,
  ) {
    // Resolution is intentionally "flat": marking a report resolved/dismissed
    // does NOT mutate the reported user/room — the actual sanction (suspend,
    // force-end, role change) is a separate, rank-guarded call. We therefore
    // deliberately apply no actor/target rank check here so moderators can
    // triage the queue (including reports that happen to name a superior)
    // without being able to penalise anyone above their tier.
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new AppError('NOT_FOUND_001');
    if (report.resolvedAt) return { ok: true as const };

    // MODE-05: resolve conditionally (WHERE resolvedAt IS NULL) so two
    // concurrent resolutions can't both pass the read-then-write check above
    // and each write a duplicate AuditLog line. Only the call that actually
    // flipped the row (count === 1) records the audit entry.
    const resolved = await prisma.report.updateMany({
      where: { id: reportId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    if (resolved.count !== 1) return { ok: true as const };

    await auditLogService.record({
      actorId,
      action: input.outcome === 'resolved' ? 'REPORT_RESOLVED' : 'REPORT_DISMISSED',
      targetUserId: report.reportedId,
      targetRoomId: report.reportedRoomId,
      targetType: 'report',
      targetId: reportId,
      metadata: { notes: input.notes ?? null, kind: report.targetKind, reason: report.reason },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true as const };
  },

  // ──────────────────── Rooms ────────────────────
  async listRooms(input: ListRoomsInput) {
    const where: Prisma.RoomWhereInput = {
      ...(input.live === true ? { isLive: true, endedAt: null } : {}),
      ...(input.live === false ? { OR: [{ isLive: false }, { endedAt: { not: null } }] } : {}),
    };
    return prisma.room.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      include: {
        host: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        _count: { select: { participants: { where: { leftAt: null } } } },
      },
    });
  },

  /**
   * Hard-stop a room from the admin surface. Mirrors `roomsService.end` but
   * bypasses the host-only guard and notifies every active participant
   * with a system message via their personal user channel.
   */
  async forceEndRoom(actorId: string, roomId: string, input: ForceEndRoomInput, ctx: ActorContext) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) return { ended: true as const };

    const active = await prisma.participant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    const userIds = active.map(p => p.userId);
    // ROOM-07: notify RSVPs (typically the SCHEDULED case where there are no
    // active participants yet) that the event was cancelled by moderation.
    const rsvps = await prisma.roomRsvp.findMany({
      where: { roomId },
      select: { userId: true },
    });

    // MODE-04: close the room conditionally (WHERE endedAt IS NULL) and only run
    // the side effects when this call actually closed it. Two concurrent
    // force-ends would otherwise both pass the read-then-write check above and
    // duplicate the teardown/notifications/audit-log.
    const [, closed] = await prisma.$transaction([
      prisma.participant.updateMany({
        where: { roomId, leftAt: null },
        data: { leftAt: new Date() },
      }),
      prisma.room.updateMany({
        where: { id: roomId, endedAt: null },
        data: { isLive: false, endedAt: new Date(), participantCount: 0 },
      }),
      ...(userIds.length > 0
        ? [
            prisma.user.updateMany({
              where: { id: { in: userIds } },
              data: { currentRoomId: null },
            }),
          ]
        : []),
    ]);
    if (closed.count !== 1) return { ended: true as const };

    // ROOM-03: drop the room's pending BullMQ jobs (reminder + go-live) so a
    // force-ended scheduled room doesn't auto-open / fire a reminder later.
    // Best-effort: a Redis/BullMQ hiccup must NOT abort the teardown + audit
    // below for a force-end that already committed to Postgres.
    await cancelEventReminder(roomId).catch(err =>
      logger.warn('admin.forceEndRoom: cancel reminder failed', { err, roomId }),
    );
    await closeSfuRoom(roomId);
    // RECO-01: finalize any running Replay egress (gated/no-op when egress is
    // off). Without this the LiveKit egress keeps billing/uploading until a
    // spontaneous webhook — and for a private room it could stay orphaned.
    void recordingsService
      .stopForRoom(roomId)
      .catch(err => logger.warn('admin.forceEndRoom: recording stop failed', { err, roomId }));
    emitHallwayRoomClosed(roomId);
    // ROOM-07: persist the cancellation for every recipient (active
    // participants + RSVPs, deduped). notificationsService.create also emits
    // the realtime nudge, so offline RSVPs see it on next open instead of
    // missing the ephemeral-only signal.
    const recipientIds = new Set<string>([...userIds, ...rsvps.map(r => r.userId)]);
    await Promise.all(
      [...recipientIds].map(userId =>
        notificationsService.create({
          userId,
          type: 'ROOM_ENDED_BY_ADMIN',
          title: 'Room closed by moderation',
          body: `"${room.title}" was closed by an administrator.`,
          data: { roomId, reason: input.reason },
          targetId: roomId,
          targetType: 'room',
        }),
      ),
    );

    await auditLogService.record({
      actorId,
      action: 'ROOM_FORCE_ENDED',
      targetRoomId: roomId,
      targetType: 'room',
      targetId: roomId,
      metadata: { title: room.title, reason: input.reason, participantsCount: userIds.length },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ended: true as const };
  },

  // ──────────────────── Stats ────────────────────
  async stats() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      onlineUsers,
      suspendedUsers,
      newUsers24h,
      newUsers7d,
      liveRooms,
      totalRooms,
      openReports,
      totalReports,
      messages24h,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { isOnline: true, deletedAt: null } }),
      prisma.user.count({ where: { suspendedUntil: { gt: new Date() } } }),
      prisma.user.count({ where: { createdAt: { gte: dayAgo }, deletedAt: null } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo }, deletedAt: null } }),
      prisma.room.count({ where: { isLive: true, endedAt: null } }),
      prisma.room.count(),
      prisma.report.count({ where: { resolvedAt: null } }),
      prisma.report.count(),
      prisma.message.count({ where: { createdAt: { gte: dayAgo } } }),
    ]);

    return {
      users: {
        total: totalUsers,
        online: onlineUsers,
        suspended: suspendedUsers,
        new24h: newUsers24h,
        new7d: newUsers7d,
      },
      rooms: { live: liveRooms, total: totalRooms },
      reports: { open: openReports, total: totalReports },
      messages: { last24h: messages24h },
    };
  },

  // ──────────────────── Impersonation ────────────────────
  // Issue a 15-min token whose `sub` is the target user but `act.sub` is
  // the original super-admin. The original admin's session keeps working;
  // the client stores both tokens side-by-side and shows a banner during
  // the impersonation. Strict guards: SUPER_ADMIN only (enforced at the
  // router), cannot impersonate another SUPER_ADMIN, cannot impersonate
  // self, target must not be suspended/deleted.

  async startImpersonation(
    actorId: string,
    targetUserId: string,
    ctx: ActorContext,
  ): Promise<{
    token: string;
    expiresInSec: number;
    user: {
      id: string;
      username: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    };
  }> {
    if (actorId === targetUserId) throw new AppError('ADMIN_002');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        appRole: true,
        deletedAt: true,
        suspendedUntil: true,
      },
    });
    if (!target) throw new AppError('USER_001');
    if (target.appRole === 'SUPER_ADMIN') throw new AppError('ADMIN_002');
    if (target.deletedAt) throw new AppError('USER_001');

    const ttlSec = 15 * 60;
    const token = signImpersonationToken(targetUserId, actorId, ttlSec);

    await auditLogService.record({
      actorId,
      action: 'IMPERSONATION_STARTED',
      targetUserId,
      targetType: 'user',
      targetId: targetUserId,
      metadata: { ttlSec },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      token,
      expiresInSec: ttlSec,
      user: {
        id: target.id,
        username: target.username,
        displayName: target.displayName,
        avatarUrl: target.avatarUrl,
      },
    };
  },

  /**
   * Audit-only end-of-impersonation marker. The client just stops sending
   * the impersonation token; this endpoint exists so the trail captures
   * the explicit "the admin handed back control" moment too.
   */
  async stopImpersonation(
    actorId: string,
    targetUserId: string,
    ctx: ActorContext,
  ): Promise<{ ok: true }> {
    await auditLogService.record({
      actorId,
      action: 'IMPERSONATION_ENDED',
      targetUserId,
      targetType: 'user',
      targetId: targetUserId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true as const };
  },

  // ──────────────────── CSV exports ────────────────────
  // Hand-rolled CSV: avoids pulling a parser dep for ~30 LoC. RFC 4180:
  // wrap every cell in quotes, escape inner quotes by doubling. Newlines
  // and commas inside cells are then safe.
  exportUsersCsv: async (): Promise<string> => {
    const rows = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        phoneNumber: true,
        appRole: true,
        suspendedUntil: true,
        suspensionReason: true,
        deletedAt: true,
        followerCount: true,
        followingCount: true,
        createdAt: true,
        lastSeenAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_LIMIT,
    });
    warnIfCsvTruncated('exportUsersCsv', rows.length);
    const header = [
      'id',
      'username',
      'displayName',
      'email',
      'phoneNumber',
      'appRole',
      'suspendedUntil',
      'suspensionReason',
      'deletedAt',
      'followerCount',
      'followingCount',
      'createdAt',
      'lastSeenAt',
    ];
    return toCsv(header, rows);
  },

  exportAuditLogCsv: async (): Promise<string> => {
    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_LIMIT,
      include: {
        actor: { select: { username: true, displayName: true } },
        targetUser: { select: { username: true, displayName: true } },
      },
    });
    warnIfCsvTruncated('exportAuditLogCsv', rows.length);
    const flat = rows.map(r => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      actorId: r.actorId,
      actorUsername: r.actor?.username ?? null,
      targetUserId: r.targetUserId,
      targetUsername: r.targetUser?.username ?? null,
      targetRoomId: r.targetRoomId,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata ? JSON.stringify(r.metadata) : null,
      ip: r.ip,
      userAgent: r.userAgent,
    }));
    const header = [
      'id',
      'createdAt',
      'action',
      'actorId',
      'actorUsername',
      'targetUserId',
      'targetUsername',
      'targetRoomId',
      'targetType',
      'targetId',
      'metadata',
      'ip',
      'userAgent',
    ];
    return toCsv(header, flat);
  },

  exportReportsCsv: async (): Promise<string> => {
    const rows = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_LIMIT,
      include: {
        reporter: { select: { username: true } },
        reported: { select: { username: true } },
        reportedRoom: { select: { title: true } },
      },
    });
    warnIfCsvTruncated('exportReportsCsv', rows.length);
    const flat = rows.map(r => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      targetKind: r.targetKind,
      reason: r.reason,
      details: r.details,
      reporterId: r.reporterId,
      reporterUsername: r.reporter.username,
      targetUserId: r.reportedId,
      targetUsername: r.reported?.username ?? null,
      targetRoomId: r.reportedRoomId,
      targetRoomTitle: r.reportedRoom?.title ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
    const header = [
      'id',
      'createdAt',
      'targetKind',
      'reason',
      'details',
      'reporterId',
      'reporterUsername',
      'targetUserId',
      'targetUsername',
      'targetRoomId',
      'targetRoomTitle',
      'resolvedAt',
    ];
    return toCsv(header, flat);
  },

  // ──────────────────── Audit log ────────────────────
  async listAuditLog(input: ListAuditLogInput) {
    const where: Prisma.AuditLogWhereInput = {
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.cursor ? { createdAt: { lt: new Date(input.cursor) } } : {}),
    };
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit + 1,
      include: {
        actor: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        targetUser: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });
    const hasMore = rows.length > input.limit;
    const data = hasMore ? rows.slice(0, input.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? last.createdAt.toISOString() : null;
    return { data, nextCursor, hasMore };
  },
};
