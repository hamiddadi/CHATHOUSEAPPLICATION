import { randomUUID } from 'node:crypto';
import { Prisma, type AppRole } from '@prisma/client';
import { prisma, runWriteWithRetry } from '../../config/database';
import { redis } from '../../config/redis';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { closeRoom as closeSfuRoom } from '../../webrtc/mediasoup.manager';
import {
  disconnectUserSockets,
  emitHallwayRoomClosed,
  emitRoomEnded,
  forceAllSocketsLeaveRoom,
} from '../../socket/realtime';
import { signImpersonationToken } from '../../utils/jwt';
import { cancelEventReminder } from '../../queues/eventReminders';
import { recordingsService } from '../recordings/recordings.service';
import { notificationsService } from '../notifications/notifications.service';
import {
  livekitRevocationOutboxData,
  wakeLivekitRevocation,
} from '../rooms/livekit-revocation.outbox';
import {
  livekitRoomRevocationOutboxData,
  wakeLivekitRoomRevocation,
} from '../rooms/livekit-room-revocation.outbox';
import { scheduleBackgroundTask } from '../../utils/backgroundTasks';
import { auditLogService } from './auditLog.service';
import { decodeAdminCursor, encodeAdminCursor } from './admin.cursor';
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

// Each completed page is released before the next one is fetched. The HTTP
// response remains complete while service memory stays bounded.
export const CSV_EXPORT_BATCH_SIZE = 500;

// Spreadsheet programs may execute a quoted CSV cell as a formula when its
// first meaningful character is =, +, -, @, TAB, CR or LF. Leading whitespace
// is deliberately included because spreadsheet importers do not agree on
// which whitespace they trim before formula detection.
const DANGEROUS_CSV_STRING_PREFIX = /^(?:\s*[=+\-@]|[^\S\r\n\t]*[\t\r\n])/u;

export const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '""';
  const raw = v instanceof Date ? v.toISOString() : String(v);
  // An apostrophe is the spreadsheet-standard explicit text marker. Put it
  // before the original leading whitespace/control character, then apply
  // normal RFC 4180 escaping below.
  const s = typeof v === 'string' && DANGEROUS_CSV_STRING_PREFIX.test(raw) ? `'${raw}` : raw;
  // Escape inner quotes per RFC 4180. Newlines/commas survive once wrapped.
  return `"${s.replace(/"/g, '""')}"`;
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

interface RevokedAdminPresence {
  roomId: string;
  transitionId: string;
}

interface AdminProviderRevocations {
  participants: RevokedAdminPresence[];
  rooms: string[];
}

type AdminActorState = {
  appRole: AppRole;
  deletedAt: Date | null;
  suspendedUntil: Date | null;
};

const assertActiveAdminActor = (
  actor: AdminActorState,
  requiredRole?: AppRole,
  now = new Date(),
): void => {
  if (actor.deletedAt) throw new AppError('AUTH_003');
  if (actor.suspendedUntil && actor.suspendedUntil > now) {
    throw new AppError('AUTH_007');
  }
  if (requiredRole && ROLE_RANK[actor.appRole] < ROLE_RANK[requiredRole]) {
    throw new AppError('AUTH_008');
  }
};

/**
 * Revoke every active room presence while holding Room -> User locks, update
 * denormalized counts, and persist one provider hand-off per real transition.
 * A concurrent join waits on the same User row and then fails its suspension /
 * deletion recheck after this transaction commits.
 */
const revokeActiveRoomPresence = async (
  tx: Prisma.TransactionClient,
  userId: string,
  revokedAt: Date,
  actorId?: string,
  requiredActorRole: AppRole = 'MODERATOR',
): Promise<AdminProviderRevocations> => {
  const [beforeLock, hostedBeforeLock] = await Promise.all([
    tx.participant.findMany({
      where: { userId, leftAt: null },
      select: { roomId: true },
    }),
    tx.room.findMany({
      where: { hostId: userId, endedAt: null },
      select: { id: true },
    }),
  ]);
  const roomIds = [
    ...new Set([...beforeLock.map(row => row.roomId), ...hostedBeforeLock.map(room => room.id)]),
  ].sort();
  if (roomIds.length > 0) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Room" WHERE id IN (${Prisma.join(roomIds)}) ORDER BY id FOR UPDATE`,
    );
  }
  const moderationUserIds = [...new Set([userId, ...(actorId ? [actorId] : [])])].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(moderationUserIds)}) ORDER BY id FOR UPDATE`,
  );
  if (actorId) {
    const [lockedActor, lockedTarget] = await Promise.all([
      tx.user.findUnique({
        where: { id: actorId },
        select: { appRole: true, deletedAt: true, suspendedUntil: true },
      }),
      tx.user.findUnique({ where: { id: userId }, select: { appRole: true } }),
    ]);
    if (!lockedActor) throw new AppError('AUTH_003');
    if (!lockedTarget) throw new AppError('USER_001');
    assertActiveAdminActor(lockedActor, requiredActorRole);
    assertCanActOn(lockedActor, lockedTarget);
  }
  const [active, hostedRooms] = await Promise.all([
    tx.participant.findMany({
      where: { userId, leftAt: null },
      select: { roomId: true },
    }),
    tx.room.findMany({
      where: { hostId: userId, endedAt: null },
      select: { id: true },
    }),
  ]);
  const hostedRoomIds = hostedRooms.map(room => room.id);
  const activeRoomIds = [...new Set(active.map(row => row.roomId))];
  const allCurrentRoomIds = [...new Set([...activeRoomIds, ...hostedRoomIds])];
  const newlyVisibleRoomIds = allCurrentRoomIds.filter(roomId => !roomIds.includes(roomId)).sort();
  if (newlyVisibleRoomIds.length > 0) {
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "Room" WHERE id IN (${Prisma.join(newlyVisibleRoomIds)}) ORDER BY id FOR UPDATE`,
    );
  }
  // Fail-safe moderation semantics: a suspended/deleted host cannot leave a
  // live room with no authority. Close every hosted room and evict all of its
  // participants atomically; one room-level provider event tears down audio.
  if (hostedRoomIds.length > 0) {
    const hostedParticipants = await tx.participant.findMany({
      where: { roomId: { in: hostedRoomIds }, leftAt: null },
      select: { userId: true },
    });
    const hostedUserIds = [...new Set(hostedParticipants.map(row => row.userId))].sort();
    if (hostedUserIds.length > 0) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(hostedUserIds)}) ORDER BY id FOR UPDATE`,
      );
      await tx.user.updateMany({
        where: { id: { in: hostedUserIds }, currentRoomId: { in: hostedRoomIds } },
        data: { currentRoomId: null },
      });
    }
    await tx.participant.updateMany({
      where: { roomId: { in: hostedRoomIds }, leftAt: null },
      data: { leftAt: revokedAt },
    });
    await tx.room.updateMany({
      where: { id: { in: hostedRoomIds }, endedAt: null },
      data: { isLive: false, endedAt: revokedAt, participantCount: 0 },
    });
    await tx.roomHandRaise.deleteMany({ where: { roomId: { in: hostedRoomIds } } });
  }

  const nonHostedActiveRoomIds = activeRoomIds.filter(roomId => !hostedRoomIds.includes(roomId));
  if (nonHostedActiveRoomIds.length > 0) {
    await tx.participant.updateMany({
      where: { userId, roomId: { in: nonHostedActiveRoomIds }, leftAt: null },
      // Suspension/deletion is a punitive presence revocation. Never let an
      // expired suspension resurrect a previous room moderator/stage role.
      data: { leftAt: revokedAt, role: 'LISTENER', isMuted: true },
    });
    await tx.user.updateMany({
      where: { id: userId, currentRoomId: { in: nonHostedActiveRoomIds } },
      data: { currentRoomId: null },
    });
    await tx.roomHandRaise.deleteMany({
      where: { userId, roomId: { in: nonHostedActiveRoomIds } },
    });
  }
  for (const roomId of nonHostedActiveRoomIds) {
    await tx.$executeRaw`UPDATE "Room" SET "participantCount" = GREATEST("participantCount" - 1, 0) WHERE id = ${roomId}`;
  }
  const transitions = nonHostedActiveRoomIds.map(roomId => ({
    roomId,
    transitionId: randomUUID(),
  }));
  const roomTransitions = hostedRoomIds.map(roomId => ({ roomId, transitionId: randomUUID() }));
  const outboxData = [
    ...transitions.map(transition =>
      livekitRevocationOutboxData({ roomId: transition.roomId, userId }, transition.transitionId),
    ),
    ...roomTransitions.map(transition =>
      livekitRoomRevocationOutboxData(transition.roomId, transition.transitionId),
    ),
  ];
  if (outboxData.length > 0) await tx.outboxEvent.createMany({ data: outboxData });
  return { participants: transitions, rooms: hostedRoomIds };
};

const wakeAdminPresenceRevocations = async (
  operation: string,
  transitions: AdminProviderRevocations,
): Promise<void> => {
  for (const transition of transitions.participants) {
    await scheduleBackgroundTask(wakeLivekitRevocation(transition.transitionId), err =>
      logger.warn(`${operation}: LiveKit revocation wake failed`, {
        err,
        roomId: transition.roomId,
      }),
    );
  }
  for (const roomId of transitions.rooms) {
    await scheduleBackgroundTask(wakeLivekitRoomRevocation(roomId), err =>
      logger.warn(`${operation}: LiveKit room revocation wake failed`, { err, roomId }),
    );
  }
};

const finalizeAdminHostedRoomClosures = async (
  operation: string,
  roomIds: string[],
): Promise<void> => {
  for (const roomId of roomIds) {
    await closeSfuRoom(roomId);
    emitHallwayRoomClosed(roomId);
    emitRoomEnded(roomId);
    forceAllSocketsLeaveRoom(roomId);
    await scheduleBackgroundTask(recordingsService.stopForRoom(roomId), err =>
      logger.warn(`${operation}: recording stop failed`, { err, roomId }),
    );
  }
};

const fetchActor = async (actorId: string) => {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { id: true, appRole: true, deletedAt: true, suspendedUntil: true },
  });
  if (!actor) throw new AppError('AUTH_003');
  assertActiveAdminActor(actor);
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

type StableCursorWhere = {
  createdAt?: { lt: Date };
  OR?: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
};

interface CsvCursor {
  createdAt: Date;
  id: string;
}

const csvCursorWhere = (cursor: CsvCursor): StableCursorWhere => ({
  OR: [
    { createdAt: { lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
  ],
});

const streamCsv = async function* <Row extends { id: string; createdAt: Date }>(
  header: readonly string[],
  fetchPage: (cursor?: CsvCursor) => Promise<readonly Row[]>,
  flatten: (row: Row) => Record<string, unknown>,
): AsyncGenerator<string> {
  // Load only the first bounded page before yielding the CSV header. The
  // controller preflights this first chunk, allowing an initial database error
  // to be rendered normally before download headers are committed.
  let rows = await fetchPage();
  yield header.map(csvCell).join(',');

  for (;;) {
    if (rows.length === 0) return;
    for (const row of rows) {
      const flat = flatten(row);
      yield `\r\n${header.map(column => csvCell(flat[column])).join(',')}`;
    }
    const last = rows.at(-1);
    if (!last || rows.length < CSV_EXPORT_BATCH_SIZE) return;
    rows = await fetchPage({ createdAt: last.createdAt, id: last.id });
  }
};

const stableCursorWhere = (cursor: string): StableCursorWhere => {
  const decoded = decodeAdminCursor(cursor);
  if (!decoded) throw new AppError('VALIDATION_001');

  if (decoded.id === null) {
    // Backward compatibility for a cursor emitted by an older API version.
    return { createdAt: { lt: decoded.createdAt } };
  }

  return {
    OR: [
      { createdAt: { lt: decoded.createdAt } },
      { createdAt: decoded.createdAt, id: { lt: decoded.id } },
    ],
  };
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
      // Nest the cursor OR under AND so it cannot collide with the search or
      // suspension OR predicates above.
      ...(input.cursor ? { AND: [stableCursorWhere(input.cursor)] } : {}),
    };
    const rows = await prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      select: publicAdminUser,
    });
    const hasMore = rows.length > input.limit;
    const data = hasMore ? rows.slice(0, input.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? encodeAdminCursor(last.createdAt, last.id) : null;
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
    const atomicMutation: {
      updated: Prisma.UserGetPayload<{ select: typeof publicAdminUser }>;
      previousRole: AppRole;
    } = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        const ids = [actorId, targetUserId].sort();
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
        );
        const [lockedActor, lockedTarget] = await Promise.all([
          tx.user.findUnique({
            where: { id: actorId },
            select: { appRole: true, deletedAt: true, suspendedUntil: true },
          }),
          tx.user.findUnique({ where: { id: targetUserId }, select: { appRole: true } }),
        ]);
        if (!lockedActor) throw new AppError('AUTH_003');
        if (!lockedTarget) throw new AppError('USER_001');
        assertActiveAdminActor(lockedActor, 'SUPER_ADMIN');
        if (ROLE_RANK[input.role] > ROLE_RANK[lockedActor.appRole]) {
          throw new AppError('ADMIN_002');
        }
        assertCanActOn(lockedActor, lockedTarget);
        if (lockedTarget.appRole === 'SUPER_ADMIN' && input.role !== 'SUPER_ADMIN') {
          const remaining = await tx.user.count({
            where: { appRole: 'SUPER_ADMIN', id: { not: targetUserId } },
          });
          if (remaining === 0) throw new AppError('ADMIN_001');
        }
        const updated = await tx.user.update({
          where: { id: targetUserId },
          data: { appRole: input.role },
          select: publicAdminUser,
        });
        return { updated, previousRole: lockedTarget.appRole };
      }),
    );
    await auditLogService.record({
      actorId,
      action: 'USER_ROLE_CHANGED',
      targetUserId,
      targetType: 'user',
      targetId: targetUserId,
      metadata: { from: atomicMutation.previousRole, to: input.role },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return atomicMutation.updated;
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

    const suspendedAt = new Date();
    const mutation = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          const revocations = await revokeActiveRoomPresence(
            tx,
            targetUserId,
            suspendedAt,
            actorId,
          );
          await tx.refreshToken.updateMany({
            where: { userId: targetUserId, revokedAt: null },
            data: { revokedAt: suspendedAt },
          });
          const updated = await tx.user.update({
            where: { id: targetUserId },
            data: {
              suspendedUntil: expiresAt,
              suspensionReason: input.reason,
              isOnline: false,
              isVisible: false,
              latitude: null,
              longitude: null,
              currentRoomId: null,
              tokenVersion: { increment: 1 },
            },
            select: publicAdminUser,
          });
          return { updated, revocations };
        },
        { maxWait: 5_000, timeout: 15_000 },
      ),
    );
    const { updated } = mutation;

    // Force the lockout to land within the cache TTL window. We mark the
    // cache "suspended" up to the same expiry so requireAuth doesn't even
    // hit Postgres until the sanction lapses.
    const ttlSec = Math.min(
      SUSPENSION_CACHE_TTL_SEC, // cap 1h to avoid stale cache after a manual unsuspend
      Math.max(30, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)),
    );
    await redis.setEx(`user:susp:${targetUserId}`, ttlSec, '1');
    disconnectUserSockets(targetUserId, 'account_suspended');
    await wakeAdminPresenceRevocations('admin.suspend', mutation.revocations);
    await finalizeAdminHostedRoomClosures('admin.suspend', mutation.revocations.rooms);

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
    if (actorId === targetUserId) throw new AppError('ADMIN_002');
    const atomicMutation: {
      updated: Prisma.UserGetPayload<{ select: typeof publicAdminUser }>;
      previousUntil: Date | null;
      previousReason: string | null;
    } = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        const ids = [actorId, targetUserId].sort();
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
        );
        const [lockedActor, lockedTarget] = await Promise.all([
          tx.user.findUnique({
            where: { id: actorId },
            select: { appRole: true, deletedAt: true, suspendedUntil: true },
          }),
          tx.user.findUnique({
            where: { id: targetUserId },
            select: { appRole: true, suspendedUntil: true, suspensionReason: true },
          }),
        ]);
        if (!lockedActor) throw new AppError('AUTH_003');
        if (!lockedTarget) throw new AppError('USER_001');
        assertActiveAdminActor(lockedActor, 'MODERATOR');
        assertCanActOn(lockedActor, lockedTarget);
        const updated = await tx.user.update({
          where: { id: targetUserId },
          data: { suspendedUntil: null, suspensionReason: null },
          select: publicAdminUser,
        });
        return {
          updated,
          previousUntil: lockedTarget.suspendedUntil,
          previousReason: lockedTarget.suspensionReason,
        };
      }),
    );
    await redis.del(`user:susp:${targetUserId}`);
    await auditLogService.record({
      actorId,
      action: 'USER_UNSUSPENDED',
      targetUserId,
      targetType: 'user',
      targetId: targetUserId,
      metadata: {
        previousUntil: atomicMutation.previousUntil?.toISOString() ?? null,
        previousReason: atomicMutation.previousReason,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return atomicMutation.updated;
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

    const deletedAt = new Date();
    const revocations = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          const transitions = await revokeActiveRoomPresence(
            tx,
            targetUserId,
            deletedAt,
            actorId,
            'SUPER_ADMIN',
          );
          await tx.user.update({
            where: { id: targetUserId },
            data: {
              deletedAt,
              suspendedUntil: PERMANENT_BAN_DATE,
              suspensionReason: 'Account scheduled for deletion (admin)',
              isOnline: false,
              isVisible: false,
              latitude: null,
              longitude: null,
              currentRoomId: null,
              tokenVersion: { increment: 1 },
            },
          });
          await tx.refreshToken.updateMany({
            where: { userId: targetUserId, revokedAt: null },
            data: { revokedAt: deletedAt },
          });
          await tx.pushToken.deleteMany({ where: { userId: targetUserId } });
          return transitions;
        },
        { maxWait: 5_000, timeout: 15_000 },
      ),
    );
    await redis.setEx(`user:susp:${targetUserId}`, SUSPENSION_CACHE_TTL_SEC, '1');
    disconnectUserSockets(targetUserId, 'account_deleted');
    await wakeAdminPresenceRevocations('admin.deleteUser', revocations);
    await finalizeAdminHostedRoomClosures('admin.deleteUser', revocations.rooms);

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
      ...(input.cursor ? { AND: [stableCursorWhere(input.cursor)] } : {}),
    };
    const rows = await prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      include: {
        reporter: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        reported: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        reportedRoom: { select: { id: true, title: true, isLive: true, hostId: true } },
        contentAuthor: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
    const hasMore = rows.length > input.limit;
    const data = hasMore ? rows.slice(0, input.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? encodeAdminCursor(last.createdAt, last.id) : null;
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
      targetUserId: report.reportedId ?? report.contentAuthorId,
      targetRoomId: report.reportedRoomId,
      targetType: 'report',
      targetId: reportId,
      metadata: {
        notes: input.notes ?? null,
        kind: report.targetKind,
        reason: report.reason,
        reportedMessageId: report.reportedMessageId,
        reportedGroupMessageId: report.reportedGroupMessageId,
        reportedRoomMessageId: report.reportedRoomMessageId,
        contentContextId: report.contentContextId,
      },
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
    const closure = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
          const room = await tx.room.findUnique({ where: { id: roomId } });
          if (!room) throw new AppError('ROOM_001');
          if (room.endedAt) return { room, closed: false as const, userIds: [] as string[] };

          const active = await tx.participant.findMany({
            where: { roomId, leftAt: null },
            select: { userId: true },
          });
          const userIds = active.map(participant => participant.userId).sort();
          const lockIds = [...new Set([...userIds, actorId])].sort();
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "User" WHERE id IN (${Prisma.join(lockIds)}) ORDER BY id FOR UPDATE`,
          );
          const lockedActor = await tx.user.findUnique({
            where: { id: actorId },
            select: { appRole: true, deletedAt: true, suspendedUntil: true },
          });
          if (!lockedActor) throw new AppError('AUTH_003');
          assertActiveAdminActor(lockedActor, 'ADMIN');
          await tx.participant.updateMany({
            where: { roomId, leftAt: null },
            data: { leftAt: new Date() },
          });
          await tx.room.update({
            where: { id: roomId },
            data: { isLive: false, endedAt: new Date(), participantCount: 0 },
          });
          if (userIds.length > 0) {
            await tx.user.updateMany({
              where: { id: { in: userIds }, currentRoomId: roomId },
              data: { currentRoomId: null },
            });
          }
          await tx.roomHandRaise.deleteMany({ where: { roomId } });
          const transitionId = randomUUID();
          await tx.outboxEvent.create({
            data: livekitRoomRevocationOutboxData(roomId, transitionId),
          });
          return { room, closed: true as const, userIds };
        },
        { maxWait: 5_000, timeout: 15_000 },
      ),
    );
    if (!closure.closed) return { ended: true as const };
    const { room, userIds } = closure;
    // ROOM-07: notify RSVPs (typically the SCHEDULED case where there are no
    // active participants yet) that the event was cancelled by moderation.
    const rsvps = await prisma.roomRsvp.findMany({
      where: { roomId },
      select: { userId: true },
    });

    // ROOM-03: drop the room's pending BullMQ jobs (reminder + go-live) so a
    // force-ended scheduled room doesn't auto-open / fire a reminder later.
    // Best-effort: a Redis/BullMQ hiccup must NOT abort the teardown + audit
    // below for a force-end that already committed to Postgres.
    if (room.scheduledFor) {
      await cancelEventReminder(roomId).catch(err =>
        logger.warn('admin.forceEndRoom: cancel reminder failed', { err, roomId }),
      );
    }
    await closeSfuRoom(roomId);
    await scheduleBackgroundTask(wakeLivekitRoomRevocation(roomId), err =>
      logger.warn('admin.forceEndRoom: LiveKit room revocation wake failed', { err, roomId }),
    );
    // RECO-01: finalize any running Replay egress (gated/no-op when egress is
    // off). Without this the LiveKit egress keeps billing/uploading until a
    // spontaneous webhook — and for a private room it could stay orphaned.
    void recordingsService
      .stopForRoom(roomId)
      .catch(err => logger.warn('admin.forceEndRoom: recording stop failed', { err, roomId }));
    if (!room.isPrivate && room.roomType === 'OPEN') {
      emitHallwayRoomClosed(roomId);
    }
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
  exportUsersCsv: (): AsyncGenerator<string> => {
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
    return streamCsv(
      header,
      cursor =>
        prisma.user.findMany({
          where: cursor ? csvCursorWhere(cursor) : undefined,
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
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: CSV_EXPORT_BATCH_SIZE,
        }),
      row => ({ ...row }),
    );
  },

  exportAuditLogCsv: (): AsyncGenerator<string> => {
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
    return streamCsv(
      header,
      cursor =>
        prisma.auditLog.findMany({
          where: cursor ? csvCursorWhere(cursor) : undefined,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: CSV_EXPORT_BATCH_SIZE,
          include: {
            actor: { select: { username: true, displayName: true } },
            targetUser: { select: { username: true, displayName: true } },
          },
        }),
      row => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        actorId: row.actorId,
        actorUsername: row.actor?.username ?? null,
        targetUserId: row.targetUserId,
        targetUsername: row.targetUser?.username ?? null,
        targetRoomId: row.targetRoomId,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata ? JSON.stringify(row.metadata) : null,
        ip: row.ip,
        userAgent: row.userAgent,
      }),
    );
  },

  exportReportsCsv: (): AsyncGenerator<string> => {
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
      'contentAuthorId',
      'contentAuthorUsername',
      'reportedMessageId',
      'reportedGroupMessageId',
      'reportedRoomMessageId',
      'contentKind',
      'contentSnapshot',
      'contentAudioUrl',
      'contentAudioDurationMs',
      'contentCreatedAt',
      'contentContextId',
      'contentContextSnapshot',
      'resolvedAt',
    ];
    return streamCsv(
      header,
      cursor =>
        prisma.report.findMany({
          where: cursor ? csvCursorWhere(cursor) : undefined,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: CSV_EXPORT_BATCH_SIZE,
          include: {
            reporter: { select: { username: true } },
            reported: { select: { username: true } },
            reportedRoom: { select: { title: true } },
            contentAuthor: { select: { username: true } },
          },
        }),
      row => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        targetKind: row.targetKind,
        reason: row.reason,
        details: row.details,
        reporterId: row.reporterId,
        reporterUsername: row.reporter.username,
        targetUserId: row.reportedId,
        targetUsername: row.reported?.username ?? null,
        targetRoomId: row.reportedRoomId,
        targetRoomTitle: row.reportedRoom?.title ?? null,
        contentAuthorId: row.contentAuthorId,
        contentAuthorUsername: row.contentAuthor?.username ?? null,
        reportedMessageId: row.reportedMessageId,
        reportedGroupMessageId: row.reportedGroupMessageId,
        reportedRoomMessageId: row.reportedRoomMessageId,
        contentKind: row.contentKind,
        contentSnapshot: row.contentSnapshot,
        contentAudioUrl: row.contentAudioUrl,
        contentAudioDurationMs: row.contentAudioDurationMs,
        contentCreatedAt: row.contentCreatedAt?.toISOString() ?? null,
        contentContextId: row.contentContextId,
        contentContextSnapshot: row.contentContextSnapshot,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      }),
    );
  },

  // ──────────────────── Audit log ────────────────────
  async listAuditLog(input: ListAuditLogInput) {
    const where: Prisma.AuditLogWhereInput = {
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.cursor ? { AND: [stableCursorWhere(input.cursor)] } : {}),
    };
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      include: {
        actor: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        targetUser: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
    });
    const hasMore = rows.length > input.limit;
    const data = hasMore ? rows.slice(0, input.limit) : rows;
    const last = data[data.length - 1];
    const nextCursor = hasMore && last ? encodeAdminCursor(last.createdAt, last.id) : null;
    return { data, nextCursor, hasMore };
  },
};
