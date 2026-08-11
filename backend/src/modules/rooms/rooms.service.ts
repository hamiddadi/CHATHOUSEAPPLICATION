import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, runWriteWithRetry } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { legalAcceptanceSelect, legalAcceptanceStatus } from '../auth/legal-acceptance';
import { recordingsService } from '../recordings/recordings.service';
import { auditLogService } from '../admin/auditLog.service';
import { getBlockedIdSet } from '../social/blocks';
import { lockUserRows } from '../social/relationship-lock';
import { cancelEventReminder, scheduleEventReminder } from '../../queues/eventReminders';
import { fanoutOne } from '../../extensions/queues/followFanout';
import { emitRoomJoinedByFollowing } from '../../extensions/realtime/aliases';
import { canRaiseHandUnderRoomSettings } from '../../extensions/modules/roomSettingsExt/roomSettingsExt.policy';
import { logger } from '../../config/logger';
import { runIdempotentCreate } from '../../utils/idempotency';
import { scheduleBackgroundTask } from '../../utils/backgroundTasks';
import {
  notificationDeliveryOutboxData,
  wakeRoomInviteDelivery,
} from '../notifications/notification.outbox';
import {
  closeRoom as closeSfuRoom,
  closeTransportsForUserInRoom,
} from '../../webrtc/mediasoup.manager';
import {
  emitHallwayRoomClosed,
  emitHallwayRoomCreated,
  emitHallwayRoomUpdated,
  emitMapUserUpdate,
  emitRoomEnded,
  emitRoomHandLowered,
  emitRoomHandRaised,
  emitRoomMessage,
  emitRoomMetaUpdated,
  emitRoomMuteChanged,
  emitRoomReaction,
  emitRoomRoleChanged,
  emitRoomUserJoined,
  emitRoomUserKicked,
  emitRoomUserLeft,
  forceAllSocketsLeaveRoom,
  forceLeaveRoom,
  forceUserSocketsLeaveRoom,
} from '../../socket/realtime';
import { livekitRevocationOutboxData, wakeLivekitRevocation } from './livekit-revocation.outbox';
import {
  livekitRoomRevocationOutboxData,
  wakeLivekitRoomRevocation,
} from './livekit-room-revocation.outbox';
import type {
  CreateRoomInput,
  InviteToRoomInput,
  ListRoomsInput,
  MuteAllInput,
  MuteInput,
  SendReactionInput,
  SendRoomMessageInput,
  ToggleRoomChatInput,
  UpdateRoleInput,
  UpdateRoomTitleInput,
} from './rooms.schema';
import { livekitService, type LivekitParticipantRole } from './livekit.service';
import {
  assertRoomMetadataAccess,
  discoverableRoomWhere,
  roomMetadataAccessWhere,
} from './rooms.access';
import { getPersonalizedRoomFeed } from './room-feed.service';
import { canRefreshReconnectAdmission } from './participant-admission.policy';

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

const MS_PER_MINUTE = 60_000;
// Default ban applied on kick when no explicit duration is given — long
// enough to discourage immediate re-join, short enough to forgive a mistake.
const DEFAULT_KICK_BAN_MINUTES = 30;

export interface ParticipantAdmissionIdentity {
  participantId: string;
  joinedAt: Date;
  admissionConfirmedAt: Date | null;
}

interface LeaveOptions {
  /**
   * Crash/failed-socket cleanup may leave only the exact admission snapshot it
   * observed. A newer rejoin or confirmation makes the conditional update a
   * no-op and therefore cannot be evicted by a stale reconciliation cycle.
   */
  admission?: ParticipantAdmissionIdentity & {
    staleBefore?: Date;
    /**
     * Reconciliation snapshots have a finite lifetime. Re-check this while
     * holding the Room lock so lock waits/retries cannot apply an expired
     * cluster view when selecting a host successor or closing the room.
     */
    snapshotStillValid?: () => boolean;
  };
}

const roomInclude = {
  host: { select: publicUser },
  participants: {
    include: { user: { select: publicUser } },
    where: { leftAt: null, user: { deletedAt: null } },
  },
  club: { select: { id: true, name: true, iconUrl: true } },
  _count: { select: { rsvps: true } },
} satisfies Prisma.RoomInclude;

/**
 * Same as requireHost but also allows MODERATOR role. Used for actions
 * like kick and mute that moderators should be able to perform.
 */
const requireHostOrMod = async (roomId: string, userId: string) => {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new AppError('ROOM_001');
  if (room.endedAt) throw new AppError('ROOM_004');
  if (room.hostId === userId) return room;
  const p = await prisma.participant.findUnique({
    where: { userId_roomId: { userId, roomId } },
    select: { role: true, leftAt: true },
  });
  // Room.hostId is the sole HOST authority. Accepting a stale Participant
  // role=HOST would let a former host regain moderation after a hand-off.
  if (!p || p.leftAt || p.role !== 'MODERATOR') {
    throw new AppError('ROOM_003');
  }
  return room;
};

/**
 * Transactional authority check for privileged mutations. Every room role,
 * leave, kick and hand-off path takes the Room lock first, so keeping that
 * same lock through the write gives the authorization decision a real
 * linearization point instead of a check-then-mutate race.
 */
const requireHostOrModLocked = async (
  tx: Prisma.TransactionClient,
  roomId: string,
  userId: string,
) => {
  await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
  const room = await tx.room.findUnique({ where: { id: roomId } });
  if (!room) throw new AppError('ROOM_001');
  if (room.endedAt || !room.isLive) throw new AppError('ROOM_004');
  if (room.hostId === userId) return room;
  const participant = await tx.participant.findUnique({
    where: { userId_roomId: { userId, roomId } },
    select: { role: true, leftAt: true },
  });
  if (!participant || participant.leftAt || participant.role !== 'MODERATOR') {
    throw new AppError('ROOM_003');
  }
  return room;
};

const requireHostLocked = async (tx: Prisma.TransactionClient, roomId: string, userId: string) => {
  await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
  const room = await tx.room.findUnique({ where: { id: roomId } });
  if (!room) throw new AppError('ROOM_001');
  if (room.endedAt || !room.isLive) throw new AppError('ROOM_004');
  if (room.hostId !== userId) throw new AppError('ROOM_003');
  return room;
};

export const roomsService = {
  /**
   * Issue room audio credentials only while both sides of the membership are
   * active: the Participant has not left and the parent Room is still live.
   * Reading both records together closes the stale-participant hole where an
   * ended room retained leftAt = null.
   */
  async issueLivekitToken(roomId: string, userId: string) {
    // Cheap fail-closed preflight prevents arbitrary authenticated room ids
    // from provisioning orphaned LiveKit rooms. Every decision is re-read
    // under locks below; this first read is only an allocation guard.
    const preflight = await prisma.participant.findUnique({
      where: { userId_roomId: { userId, roomId } },
      select: {
        leftAt: true,
        admissionConfirmedAt: true,
        room: { select: { isLive: true, endedAt: true, hostId: true } },
        user: { select: { deletedAt: true, suspendedUntil: true } },
      },
    });
    if (!preflight) throw new AppError('ROOM_005');
    if (!preflight.room.isLive || preflight.room.endedAt) throw new AppError('ROOM_004');
    if (preflight.leftAt || preflight.admissionConfirmedAt === null) {
      throw new AppError('ROOM_005');
    }
    if (
      preflight.user.deletedAt ||
      (preflight.user.suspendedUntil && preflight.user.suspendedUntil > new Date())
    ) {
      throw new AppError('AUTH_007');
    }
    if (preflight.room.hostId !== userId) {
      const blocked = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: preflight.room.hostId },
            { blockerId: preflight.room.hostId, blockedId: userId },
          ],
        },
        select: { id: true },
      });
      if (blocked) throw new AppError('ROOM_007');
    }

    // Provision before taking a database lock. Room-revocation events repeat
    // through the full token horizon, so a concurrent close still converges.
    await livekitService.ensureRoom(roomId);

    return runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          // Signing is inside the Room -> User -> Participant serialization
          // boundary shared by join/leave/block/end. A revocation therefore
          // linearizes strictly before or after this capability is issued.
          await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
          const [room, participant, user] = await Promise.all([
            tx.room.findUnique({
              where: { id: roomId },
              select: { isLive: true, endedAt: true, hostId: true },
            }),
            tx.participant.findUnique({
              where: { userId_roomId: { userId, roomId } },
              select: {
                role: true,
                isMuted: true,
                leftAt: true,
                admissionConfirmedAt: true,
              },
            }),
            tx.user.findUnique({
              where: { id: userId },
              select: {
                deletedAt: true,
                suspendedUntil: true,
                ...legalAcceptanceSelect,
              },
            }),
          ]);
          if (!room) throw new AppError('ROOM_001');
          if (!room.isLive || room.endedAt) throw new AppError('ROOM_004');
          if (!participant || participant.leftAt || participant.admissionConfirmedAt === null) {
            throw new AppError('ROOM_005');
          }
          if (!user || user.deletedAt) throw new AppError('USER_001');
          if (user.suspendedUntil && user.suspendedUntil > new Date()) {
            throw new AppError('AUTH_007');
          }
          if (room.hostId !== userId) {
            const block = await tx.block.findFirst({
              where: {
                OR: [
                  { blockerId: userId, blockedId: room.hostId },
                  { blockerId: room.hostId, blockedId: userId },
                ],
              },
              select: { id: true },
            });
            if (block) throw new AppError('ROOM_007');
          }

          // Room.hostId is authoritative for host capability. Historical
          // Participant rows may contain HOST after an older hand-off, so
          // never turn that stale label into a publish grant or HOST token.
          const effectiveRole: LivekitParticipantRole =
            room.hostId === userId
              ? 'HOST'
              : participant.role === 'HOST'
                ? 'LISTENER'
                : (participant.role as LivekitParticipantRole);
          const stageRole =
            effectiveRole === 'HOST' ||
            effectiveRole === 'MODERATOR' ||
            effectiveRole === 'SPEAKER';
          const canPublish =
            stageRole &&
            !participant.isMuted &&
            !legalAcceptanceStatus(user).legalAcceptanceRequired;
          return livekitService.issueRoomToken({
            roomId,
            userId,
            role: effectiveRole,
            canPublish,
            roomReady: true,
          });
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );
  },

  async list(viewerId: string, input: ListRoomsInput) {
    // Default `filter` falls back to the legacy `live` flag so existing
    // callers keep working without code changes.
    const effectiveFilter = input.filter ?? (input.live === false ? undefined : 'live');

    // 'past' lists ended rooms (e.g. a club's room archive) — so it must
    // invert the default endedAt:null guard and instead require endedAt set.
    const isPast = effectiveFilter === 'past';

    const where: Prisma.RoomWhereInput = {
      ...(isPast ? { endedAt: { not: null } } : { endedAt: null }),
      AND: [discoverableRoomWhere(viewerId)],
      ...(input.clubId ? { clubId: input.clubId } : {}),
    };
    if (effectiveFilter === 'live') where.isLive = true;
    if (effectiveFilter === 'upcoming') where.scheduledFor = { gte: new Date() };

    const orderBy: Prisma.RoomOrderByWithRelationInput = isPast
      ? { endedAt: 'desc' }
      : effectiveFilter === 'upcoming'
        ? { scheduledFor: 'asc' }
        : { createdAt: 'desc' };

    const [blocked, rooms] = await Promise.all([
      getBlockedIdSet(viewerId),
      prisma.room.findMany({
        where,
        orderBy,
        take: input.limit,
        include: roomInclude,
      }),
    ]);
    return rooms.map(room => ({
      ...room,
      participants: room.participants.filter(participant => !blocked.has(participant.userId)),
    }));
  },

  async create(hostId: string, input: CreateRoomInput, idempotencyKey?: string) {
    // ANO-14 fix: defence-in-depth — reject room creation by suspended users
    // even if their auth token is still cached (up to SUSPENSION_CACHE_TTL_SEC).
    const host = await prisma.user.findUnique({
      where: { id: hostId },
      select: { suspendedUntil: true },
    });
    if (host?.suspendedUntil && host.suspendedUntil > new Date()) {
      throw new AppError('AUTH_007');
    }
    if (input.recordingEnabled && !env.ROOM_RECORDING_ENABLED) {
      throw new AppError('ROOM_011');
    }

    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
    const isLive = scheduledFor === null;
    // CLOSED and isPrivate are two representations of the same access mode.
    // Canonicalising them prevents roomType=CLOSED with isPrivate=false from
    // bypassing invite-only checks on legacy code paths.
    const roomType = input.isPrivate || input.roomType === 'CLOSED' ? 'CLOSED' : input.roomType;
    const isPrivate = roomType === 'CLOSED';

    // De-dupe + lowercase topics so the stored list is canonical and
    // matches how we score against User.interests (also lowercased).
    const normalisedTopics = [
      ...new Set(input.topics.map(t => t.trim().toLowerCase()).filter(Boolean)),
    ];

    // Drop the host id + duplicates from the requested co-host list. Their
    // active/block/follow eligibility is resolved under transaction locks
    // below, at the same linearization point as Room insertion.
    const requestedCoHosts = [...new Set(input.coHostIds.filter(id => id !== hostId))];
    let coHostIds: string[] = [];

    // Room + initial participants + idempotency claim commit atomically.
    const creation = await runIdempotentCreate({
      userId: hostId,
      scope: 'rooms.create',
      key: idempotencyKey,
      payload: input,
      create: async tx => {
        // Lock the optional Club before its membership read. Club member
        // removal/deletion writes this same Club row, so whichever transaction
        // commits first determines whether the room may still be attached.
        let clubOwnerId: string | null = null;
        if (input.clubId) {
          const lockedClub = await tx.$queryRaw<{ ownerId: string }[]>`
            SELECT "ownerId" FROM "Club" WHERE id = ${input.clubId} FOR UPDATE`;
          clubOwnerId = lockedClub[0]?.ownerId ?? null;
          if (!clubOwnerId) throw new AppError('CLUB_002');
        }

        // Block/follow mutations share these ordered User locks. Re-resolving
        // every social fact after the lock closes the old window where a block,
        // unfollow, suspension or deletion committed after the preflight read
        // but before Room/Participant insertion.
        const relationshipIds = [
          hostId,
          ...requestedCoHosts,
          ...(clubOwnerId ? [clubOwnerId] : []),
        ];
        await lockUserRows(tx, relationshipIds);
        const users = await tx.user.findMany({
          where: { id: { in: relationshipIds }, deletedAt: null },
          select: { id: true, currentRoomId: true, suspendedUntil: true },
        });
        const activeById = new Map(users.map(user => [user.id, user]));
        const lockedHost = activeById.get(hostId);
        const eligibilityNow = new Date();
        if (!lockedHost) throw new AppError('USER_001');
        if (lockedHost.suspendedUntil && lockedHost.suspendedUntil > eligibilityNow) {
          throw new AppError('AUTH_007');
        }
        if (isLive && lockedHost.currentRoomId) throw new AppError('ROOM_012');

        const relationshipTargets = [
          ...new Set([...requestedCoHosts, ...(clubOwnerId ? [clubOwnerId] : [])]),
        ].filter(userId => userId !== hostId);
        const blockRows =
          relationshipTargets.length === 0
            ? []
            : await tx.block.findMany({
                where: {
                  OR: [
                    { blockerId: hostId, blockedId: { in: relationshipTargets } },
                    { blockedId: hostId, blockerId: { in: relationshipTargets } },
                  ],
                },
                select: { blockerId: true, blockedId: true },
              });
        const blockedIds = new Set(
          blockRows.map(block => (block.blockerId === hostId ? block.blockedId : block.blockerId)),
        );

        if (input.clubId) {
          if (!clubOwnerId || !activeById.has(clubOwnerId) || blockedIds.has(clubOwnerId)) {
            throw new AppError('CLUB_002');
          }
          const membership = await tx.clubMember.findUnique({
            where: { clubId_userId: { clubId: input.clubId, userId: hostId } },
            select: { id: true },
          });
          if (!membership) throw new AppError('CLUB_002');
        }

        coHostIds = requestedCoHosts.filter(userId => {
          const coHost = activeById.get(userId);
          if (!coHost || blockedIds.has(userId)) return false;
          if (coHost.suspendedUntil && coHost.suspendedUntil > eligibilityNow) return false;
          // An invitation is a durable role grant, never an active presence.
          // A user already in another room may therefore receive it safely;
          // the explicit join path still prevents two simultaneous presences.
          return true;
        });
        if (roomType === 'SOCIAL' && coHostIds.length > 0) {
          const accepted = await tx.follow.findMany({
            where: {
              followerId: { in: coHostIds },
              followingId: hostId,
              status: 'ACCEPTED',
            },
            select: { followerId: true },
          });
          const acceptedIds = new Set(accepted.map(follow => follow.followerId));
          coHostIds = coHostIds.filter(userId => acceptedIds.has(userId));
        }
        // Bound durable SPEAKER grants at the authoritative transaction
        // boundary. A grant only becomes active after consent via join.
        coHostIds = coHostIds.slice(0, input.maxSpeakers);

        const created = await tx.room.create({
          data: {
            title: input.title,
            description: input.description ?? null,
            topic: input.topic ?? null,
            topics: normalisedTopics,
            isPrivate,
            roomType,
            chatEnabled: input.chatEnabled,
            // Defense in depth: even if an internal caller bypasses the controller,
            // the persisted flag remains false while the recording release switch is
            // off. Public clients are also rejected above when they request `true`.
            recordingEnabled: env.ROOM_RECORDING_ENABLED && (input.recordingEnabled ?? false),
            maxSpeakers: input.maxSpeakers,
            hostId,
            clubId: input.clubId ?? null,
            scheduledFor,
            isLive,
            participantCount: isLive ? 1 : 0,
          },
        });
        // Scheduled rooms don't auto-add the host. A live creation seats only
        // its host; invited co-hosts must explicitly join before they are live.
        if (isLive) {
          await tx.participant.create({
            data: {
              roomId: created.id,
              userId: hostId,
              role: 'HOST',
              admissionConfirmedAt: null,
            },
          });
          const seatedHost = await tx.user.updateMany({
            where: { id: hostId, deletedAt: null },
            data: { currentRoomId: created.id },
          });
          // The host row was locked and revalidated above. A mismatch rolls the
          // Room and Participant back instead of committing phantom presence.
          if (seatedHost.count !== 1) {
            throw new AppError('SERVER_001', 'Could not atomically seat the room host');
          }
        }
        if (coHostIds.length > 0) {
          // Live and scheduled co-hosts are grants, not active listeners.
          // leftAt keeps them out of counts while join preserves SPEAKER.
          const grantedAt = new Date();
          await tx.participant.createMany({
            data: coHostIds.map(userId => ({
              roomId: created.id,
              userId,
              role: 'SPEAKER' as const,
              leftAt: grantedAt,
            })),
            skipDuplicates: true,
          });
        }

        // Persist the in-app invite and its delivery hand-off in the same
        // transaction as Room/Participant. Stable ids/event keys make both
        // database records replay-safe without relying on request-local state.
        if (coHostIds.length > 0) {
          const invites = coHostIds.map(userId => {
            // Keep personal identifiers out of the outbox event key/logs. The
            // transaction itself is the idempotency boundary, so an opaque id
            // remains perfectly replay-safe.
            const notificationId = randomUUID();
            return { userId, notificationId };
          });
          await tx.notification.createMany({
            data: invites.map(({ userId, notificationId }) => ({
              id: notificationId,
              userId,
              actorId: hostId,
              type: 'ROOM_INVITE' as const,
              title: 'Co-host invite',
              body: `"${input.title}" — you're invited to co-host`,
              data: { roomId: created.id, hostId, coHost: true },
              targetId: created.id,
              targetType: 'room',
            })),
            skipDuplicates: true,
          });
          await tx.outboxEvent.createMany({
            data: invites.map(({ notificationId }) =>
              notificationDeliveryOutboxData(notificationId, created.id),
            ),
            skipDuplicates: true,
          });
        }
        return created.id;
      },
    });

    // Initial response and Idempotency-Key replay both drive the same durable
    // aggregate. A failed PENDING event is made immediately eligible; a fresh
    // PROCESSING lease is left alone so concurrent replays cannot double-send.
    await scheduleBackgroundTask(wakeRoomInviteDelivery(creation.resourceId), err =>
      logger.warn('room co-host invite delivery wake failed', {
        err,
        roomId: creation.resourceId,
      }),
    );
    const room = await prisma.room.findUnique({
      where: { id: creation.resourceId },
      include: roomInclude,
    });
    if (!room) throw new AppError('ROOM_001');

    // Queue jobs have deterministic room-scoped ids, so replaying this step is
    // safe and repairs a first response that committed PostgreSQL but lost its
    // Redis/BullMQ write. Returning before this on an idempotency replay would
    // leave a successfully-created scheduled room that never goes live.
    if (scheduledFor) {
      await scheduleEventReminder(room.id, scheduledFor);
    }
    if (creation.replayed) return room;

    // Broadcast to everyone in the hallway if the room is immediately
    // live. Scheduled rooms surface via the upcoming feed and the BullMQ
    // reminder, so no hallway event on create.
    if (isLive && !room.isPrivate && room.roomType !== 'CLOSED') {
      // SOCIAL rooms are not global hallway events: only accepted followers
      // may discover them. The personal fan-out below still reaches them.
      if (room.roomType === 'OPEN') {
        emitHallwayRoomCreated({
          id: room.id,
          title: room.title,
          hostId: room.hostId,
          clubId: room.clubId,
          isLive: room.isLive,
          scheduledFor: room.scheduledFor?.toISOString() ?? null,
          createdAt: room.createdAt.toISOString(),
        });
      }

      // Fan out a "started a room" notification to the host's followers
      // immediately on create, rather than waiting up to 30s for the
      // periodic scan worker. fanoutOne is idempotent (Redis SET NX on the
      // same dedup key the scanner uses) so this never double-notifies even
      // when the worker also picks the room up. Best-effort: a failure here
      // must never block room creation, so we swallow + log and let the scan
      // worker retry on its next pass.
      await scheduleBackgroundTask(fanoutOne(room.id), err =>
        logger.warn('rooms.create: follower fan-out failed', { err, roomId: room.id }),
      );
    }

    // Kick off the Replay recording when the host opted in (Room.recordingEnabled)
    // and egress is configured. Best-effort + gated — a no-op when egress is off,
    // and a failure here must never block room creation.
    if (isLive && room.recordingEnabled) {
      await scheduleBackgroundTask(recordingsService.startForRoom(room.id), err =>
        logger.warn('rooms.create: recording start failed', { err, roomId: room.id }),
      );
    }

    return room;
  },

  /**
   * Fetch an authorised room with its participants. Each
   * LISTENER participant is annotated with a `followedByViewer` boolean
   * computed from the viewer's follow graph (a single `prisma.follow` query
   * scoped to the listener ids). Speakers (HOST / MODERATOR / SPEAKER) are
   * returned unchanged.
   */
  async get(roomId: string, viewerId: string) {
    const room = await prisma.room.findFirst({
      where: {
        AND: [{ id: roomId }, roomMetadataAccessWhere(viewerId)],
      },
      include: roomInclude,
    });
    if (!room) throw new AppError('ROOM_001');
    const blocked = await getBlockedIdSet(viewerId);

    // Collect listener ids so we can resolve the viewer's follow edges in a
    // single query (scoped to listeners — we never expose the flag on
    // speakers, whose shape must stay untouched).
    const listenerIds = room.participants
      .filter(p => p.role === 'LISTENER' && !blocked.has(p.userId))
      .map(p => p.userId);

    let followedSet = new Set<string>();
    if (listenerIds.length > 0) {
      const edges = await prisma.follow.findMany({
        where: {
          followerId: viewerId,
          followingId: { in: listenerIds },
          status: 'ACCEPTED',
        },
        select: { followingId: true },
      });
      followedSet = new Set(edges.map(e => e.followingId));
    }

    return {
      ...room,
      participants: room.participants
        .filter(p => !blocked.has(p.userId))
        // #32: hide "ghost" participants from everyone but themselves.
        .filter(p => !p.isHidden || p.userId === viewerId)
        .map(p =>
          p.role === 'LISTENER' ? { ...p, followedByViewer: followedSet.has(p.userId) } : p,
        ),
    };
  },

  /**
   * #32: toggle the caller's "ghost"/invisible state in the room. Hidden
   * participants drop out of the audience list shown to others (they still see
   * themselves). Broadcasts a join/leave so peers refetch the filtered list.
   */
  async setHidden(roomId: string, callerUserId: string, hidden: boolean) {
    await requireActiveParticipant(roomId, callerUserId);
    const updated = await prisma.participant.updateMany({
      where: { roomId, userId: callerUserId, leftAt: null },
      data: { isHidden: hidden },
    });
    if (updated.count === 0) throw new AppError('ROOM_005');
    if (hidden) {
      emitRoomUserLeft(roomId, callerUserId);
    } else {
      emitRoomUserJoined(roomId, callerUserId);
    }
    return { hidden };
  },

  async join(roomId: string, userId: string) {
    const room = await prisma.room.findFirst({
      where: { id: roomId, host: { deletedAt: null } },
      include: {
        _count: { select: { participants: { where: { leftAt: null, role: 'SPEAKER' } } } },
      },
    });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) throw new AppError('ROOM_004');
    // Scheduled rooms aren't joinable until they go live.
    if (!room.isLive) throw new AppError('ROOM_004');

    const [existing, block] = await Promise.all([
      prisma.participant.findUnique({
        where: { userId_roomId: { userId, roomId } },
      }),
      prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: room.hostId },
            { blockerId: room.hostId, blockedId: userId },
          ],
        },
        select: { id: true },
      }),
    ]);
    if (block) throw new AppError('ROOM_007');

    // CLOSED rooms (isPrivate=true) are invite-only. The host pre-creates
    // Participant rows for invitees on creation; anyone else gets rejected
    // even if they discovered the room id. The host themselves always passes.
    if ((room.isPrivate || room.roomType === 'CLOSED') && room.hostId !== userId && !existing) {
      throw new AppError('ROOM_007');
    }

    // SOCIAL rooms gate on the follow graph: anyone but the host or an
    // existing participant must already follow the host to get in. This
    // mirrors Clubhouse's "social" mode where rooms are open to the host's
    // network rather than the whole hallway.
    if (room.roomType === 'SOCIAL' && room.hostId !== userId && (!existing || existing.leftAt)) {
      const f = await prisma.follow.findFirst({
        where: {
          followerId: userId,
          followingId: room.hostId,
          status: 'ACCEPTED',
        },
      });
      if (!f) throw new AppError('ROOM_007');
    }

    // #34: a locked room blocks NEW entries — the host and already-admitted
    // participants (incl. mods, who are participants) still pass; everyone else
    // is turned away without ending the room.
    if (room.isLocked && room.hostId !== userId && !existing) {
      throw new AppError('ROOM_010');
    }

    // Active ban check — a moderator-issued kick installs a RoomBan row;
    // expired bans are silently ignored so users can return after the
    // sanction window.
    const ban = await prisma.roomBan.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { expiresAt: true },
    });
    if (ban && (ban.expiresAt === null || ban.expiresAt > new Date())) {
      throw new AppError('ROOM_008');
    }
    // ROOM-04 fix: re-guard immediately before writing the participant. The
    // initial endedAt check happens before the ban/follow lookups; in that
    // window an auto-close (last participant leaving) could have ended the
    // room. Without this re-read a racing join would resurrect an ENDED room
    // with a live participant and a bumped count.
    const joinResult = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        // Every room lifecycle transaction locks rows in the same canonical
        // order: Room -> User -> Participant. This prevents a host hand-off
        // (which locks Room then the successor Participant) from deadlocking
        // with a concurrent join/leave that used to lock in reverse order.
        await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
        const fresh = await tx.room.findUnique({
          where: { id: roomId },
          select: {
            endedAt: true,
            isLive: true,
            participantCount: true,
            hostId: true,
            isPrivate: true,
            isLocked: true,
            roomType: true,
            maxSpeakers: true,
          },
        });
        if (!fresh || fresh.endedAt || !fresh.isLive) throw new AppError('ROOM_004');
        const joiningUser = await tx.user.findUnique({
          where: { id: userId },
          select: { currentRoomId: true, deletedAt: true, suspendedUntil: true },
        });
        if (!joiningUser || joiningUser.deletedAt) throw new AppError('USER_001');
        if (joiningUser.suspendedUntil && joiningUser.suspendedUntil > new Date()) {
          throw new AppError('AUTH_007');
        }
        if (joiningUser.currentRoomId && joiningUser.currentRoomId !== roomId) {
          throw new AppError('ROOM_012');
        }
        const lockedExisting = await tx.participant.findUnique({
          where: { userId_roomId: { userId, roomId } },
        });
        const lockedBan = await tx.roomBan.findUnique({
          where: { roomId_userId: { roomId, userId } },
          select: { expiresAt: true },
        });
        if (lockedBan && (lockedBan.expiresAt === null || lockedBan.expiresAt > new Date())) {
          throw new AppError('ROOM_008');
        }
        const lockedBlock = await tx.block.findFirst({
          where: {
            OR: [
              { blockerId: userId, blockedId: fresh.hostId },
              { blockerId: fresh.hostId, blockedId: userId },
            ],
          },
          select: { id: true },
        });
        if (lockedBlock) throw new AppError('ROOM_007');
        if (
          (fresh.isPrivate || fresh.roomType === 'CLOSED') &&
          fresh.hostId !== userId &&
          !lockedExisting
        ) {
          throw new AppError('ROOM_007');
        }
        if (fresh.isLocked && fresh.hostId !== userId && !lockedExisting) {
          throw new AppError('ROOM_010');
        }
        if (
          fresh.roomType === 'SOCIAL' &&
          fresh.hostId !== userId &&
          (!lockedExisting || lockedExisting.leftAt)
        ) {
          const acceptedFollow = await tx.follow.findFirst({
            where: {
              followerId: userId,
              followingId: fresh.hostId,
              status: 'ACCEPTED',
            },
            select: { id: true },
          });
          if (!acceptedFollow) throw new AppError('ROOM_007');
        }

        // #33: a brand-new Participant row means a distinct first-time attendee;
        // a re-join (un-leave) doesn't count again.
        const isNewParticipant = !lockedExisting;
        let wasAlreadyActive = false;
        let admission: ParticipantAdmissionIdentity | null = null;
        if (lockedExisting) {
          // Normalize authority on every re-entry. Room.hostId is the source
          // of truth; legacy rows that still say HOST after a transfer return
          // as muted listeners and cannot resurrect old privileges.
          const reentryRole =
            fresh.hostId === userId
              ? ('HOST' as const)
              : lockedExisting.role === 'HOST' || lockedExisting.role === 'MODERATOR'
                ? ('LISTENER' as const)
                : lockedExisting.role;
          if (lockedExisting.leftAt) {
            if (reentryRole === 'SPEAKER') {
              const activeSpeakers = await tx.participant.count({
                where: { roomId, leftAt: null, role: 'SPEAKER' },
              });
              if (activeSpeakers >= fresh.maxSpeakers) throw new AppError('ROOM_002');
            }
            const joinedAt = new Date();
            await tx.participant.update({
              where: { id: lockedExisting.id },
              data: {
                leftAt: null,
                joinedAt,
                admissionConfirmedAt: null,
                role: reentryRole,
                ...(reentryRole === 'LISTENER' &&
                (lockedExisting.role === 'HOST' || lockedExisting.role === 'MODERATOR')
                  ? { isMuted: true }
                  : {}),
              },
            });
            admission = {
              participantId: lockedExisting.id,
              joinedAt,
              admissionConfirmedAt: null,
            };
          } else {
            wasAlreadyActive = true;
            // REST admission normally precedes the Socket.IO admission. Let
            // the socket attempt own the same unconfirmed lease so a failed
            // channel join can compensate it exactly. A confirmed participant
            // is never reset by an idempotent join.
            if (lockedExisting.admissionConfirmedAt === null) {
              admission = {
                participantId: lockedExisting.id,
                joinedAt: lockedExisting.joinedAt,
                admissionConfirmedAt: null,
              };
            }
          }
        } else {
          const joinedAt = new Date();
          const createdParticipant = await tx.participant.create({
            data: {
              roomId,
              userId,
              role: 'LISTENER',
              joinedAt,
              admissionConfirmedAt: null,
            },
          });
          admission = {
            participantId: createdParticipant.id,
            joinedAt,
            admissionConfirmedAt: null,
          };
        }

        // Track current room + bump denormalized count
        await tx.user.update({ where: { id: userId }, data: { currentRoomId: roomId } });
        if (wasAlreadyActive) {
          return { changed: false, participantCount: fresh.participantCount, admission };
        }
        // Broadcast the COMMITTED count (read back from the atomic increment),
        // not `room.participantCount + 1` — the latter is a pre-mutation snapshot
        // that drifts under concurrent joins/leaves.
        const updatedRoom = await tx.room.update({
          where: { id: roomId },
          data: {
            participantCount: { increment: 1 },
            // #33: only bump the cumulative counter for a first-time join.
            ...(isNewParticipant ? { totalAttendees: { increment: 1 } } : {}),
          },
          select: { participantCount: true },
        });
        return { changed: true, participantCount: updatedRoom.participantCount, admission };
      }),
    );
    if (joinResult.changed) {
      if (!room.isPrivate && room.roomType === 'OPEN') {
        emitHallwayRoomUpdated(roomId, { participantCount: joinResult.participantCount });
      }

      // Ephemeral "someone you follow just joined a room" realtime ping to
      // the joiner's followers. Best-effort and fire-and-forget: it must
      // never block (or fail) the join. Not persisted as a Prisma
      // notification — there's no enum for it and the client can't be
      // regenerated, so this stays purely on the realtime tier. Only fired
      // for a genuinely new active presence (not a re-join of an already
      // active participant).
      await scheduleBackgroundTask(
        (async () => {
          const [joiner, followers] = await Promise.all([
            prisma.user.findUnique({
              where: { id: userId },
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            }),
            prisma.follow.findMany({
              where: { followingId: userId, status: 'ACCEPTED' },
              select: { followerId: true },
              take: 500,
            }),
          ]);
          if (!joiner) return;
          const payload = {
            roomId,
            userId: joiner.id,
            username: joiner.username,
            displayName: joiner.displayName,
            avatarUrl: joiner.avatarUrl,
          };
          for (const f of followers) {
            emitRoomJoinedByFollowing(f.followerId, payload);
          }
        })(),
        err =>
          logger.warn('rooms.join: follower join-activity emit failed', { err, roomId, userId }),
      );
    }

    const joinedRoom = await roomsService.get(roomId, userId);
    // Preserve the idempotency outcome for clients that need to compensate a
    // late navigation. A cancelled screen must only POST /leave when this
    // request actually activated the Participant row; otherwise a quick
    // mini-bar resume/back cycle would evict an already-active session.
    return {
      ...joinedRoom,
      changed: joinResult.changed,
      // Internal lifecycle identity. The REST controller strips this field;
      // the Socket.IO handler uses it only for exact failure compensation.
      admission: joinResult.admission,
    };
  },

  /**
   * Confirm realtime admission only after Socket.IO has joined room:<id>.
   * Refreshing the timestamp on every successful attach also gives crash
   * recovery a bounded heartbeat for rows whose disconnect callback was lost.
   */
  async confirmSocketAdmission(roomId: string, userId: string): Promise<boolean> {
    return runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
          const [room, user] = await Promise.all([
            tx.room.findUnique({
              where: { id: roomId },
              select: { isLive: true, endedAt: true },
            }),
            tx.user.findUnique({
              where: { id: userId },
              select: { currentRoomId: true, deletedAt: true, suspendedUntil: true },
            }),
          ]);
          const now = new Date();
          if (!room?.isLive || room.endedAt) return false;
          if (
            !user ||
            user.deletedAt ||
            (user.suspendedUntil !== null && user.suspendedUntil > now) ||
            user.currentRoomId !== roomId
          ) {
            return false;
          }
          const confirmed = await tx.participant.updateMany({
            where: { roomId, userId, leftAt: null },
            data: { admissionConfirmedAt: now },
          });
          return confirmed.count === 1;
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );
  },

  /**
   * Start a bounded reconnect grace window after an involuntary transport
   * loss. The Room -> User -> Participant locks serialize this heartbeat with
   * leave/end/block/admin revocation. The conditional write can only refresh
   * the exact active, already-confirmed lease observed under those locks.
   */
  async refreshSocketAdmissionForReconnect(roomId: string, userId: string): Promise<boolean> {
    return runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "Participant" WHERE "roomId" = ${roomId} AND "userId" = ${userId} FOR UPDATE`;

          const [room, user, participant] = await Promise.all([
            tx.room.findUnique({
              where: { id: roomId },
              select: { isLive: true, endedAt: true },
            }),
            tx.user.findUnique({
              where: { id: userId },
              select: { currentRoomId: true, deletedAt: true, suspendedUntil: true },
            }),
            tx.participant.findUnique({
              where: { userId_roomId: { userId, roomId } },
              select: { id: true, leftAt: true, admissionConfirmedAt: true },
            }),
          ]);
          const now = new Date();
          const state = { room, user, participant };
          if (!canRefreshReconnectAdmission(roomId, state, now)) return false;

          const refreshed = await tx.participant.updateMany({
            where: {
              id: state.participant.id,
              roomId,
              userId,
              leftAt: null,
              admissionConfirmedAt: state.participant.admissionConfirmedAt,
            },
            data: { admissionConfirmedAt: now },
          });
          return refreshed.count === 1;
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );
  },

  async compensateUnconfirmedAdmission(
    roomId: string,
    userId: string,
    admission: ParticipantAdmissionIdentity,
  ) {
    if (admission.admissionConfirmedAt !== null) {
      return { left: true, changed: false, roomClosed: false };
    }
    return roomsService.leave(roomId, userId, { admission });
  },

  async expireStaleAdmission(
    roomId: string,
    userId: string,
    admission: ParticipantAdmissionIdentity,
    staleBefore: Date,
    snapshotStillValid?: () => boolean,
  ) {
    return roomsService.leave(roomId, userId, {
      admission: { ...admission, staleBefore, snapshotStillValid },
    });
  },

  async leave(roomId: string, userId: string, options: LeaveOptions = {}) {
    const admissionWhere: Prisma.ParticipantWhereInput = options.admission
      ? {
          id: options.admission.participantId,
          AND: [
            { joinedAt: options.admission.joinedAt },
            { admissionConfirmedAt: options.admission.admissionConfirmedAt },
            ...(options.admission.staleBefore
              ? options.admission.admissionConfirmedAt === null
                ? [{ joinedAt: { lte: options.admission.staleBefore } }]
                : [{ admissionConfirmedAt: { lte: options.admission.staleBefore } }]
              : []),
          ],
        }
      : {};
    let autoClosed = false;
    let roomRevocationTransitionId: string | null = null;
    const res = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        // Keep the same Room -> User -> Participant lock order as join() and
        // host promotion. Concurrent device disconnects are then serialized
        // on the room row instead of forming a Room/Participant lock cycle.
        await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
        const lockedRoom = await tx.room.findUnique({ where: { id: roomId } });
        if (!lockedRoom) throw new AppError('ROOM_001');
        if (options.admission?.snapshotStillValid && !options.admission.snapshotStillValid()) {
          return {
            count: 0,
            revocationTransitionId: null,
            successorUserId: null,
            roomClosed: false,
            roomRevocationTransitionId: null,
            successorPermissionTransitionId: null,
            room: lockedRoom,
          };
        }
        const leavingHost = lockedRoom.hostId === userId && !lockedRoom.endedAt;
        const successor = leavingHost
          ? await tx.participant.findFirst({
              where: {
                roomId,
                leftAt: null,
                userId: { not: userId },
                role: { in: ['MODERATOR', 'SPEAKER'] },
                user: {
                  deletedAt: null,
                  OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: new Date() } }],
                },
                // During crash reconciliation only a participant observed as
                // recently attached may inherit the host role. Present peers
                // are heartbeated before absent admissions are expired.
                ...(options.admission?.staleBefore
                  ? { admissionConfirmedAt: { gt: options.admission.staleBefore } }
                  : {}),
              },
              orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
            })
          : null;
        const remaining = leavingHost
          ? await tx.participant.findMany({
              where: { roomId, leftAt: null, userId: { not: userId } },
              select: { userId: true },
            })
          : [];
        await lockUserRows(tx, [userId, ...remaining.map(row => row.userId)]);
        const leavingParticipant = await tx.participant.findUnique({
          where: { userId_roomId: { userId, roomId } },
          select: { role: true },
        });
        const revokeSessionAuthority =
          leavingHost ||
          leavingParticipant?.role === 'HOST' ||
          leavingParticipant?.role === 'MODERATOR';
        const left = await tx.participant.updateMany({
          where: { roomId, userId, leftAt: null, ...admissionWhere },
          data: {
            leftAt: new Date(),
            // A host hand-off transfers authority; the historical row must not
            // retain HOST and regain moderation/publish rights on a later join.
            ...(revokeSessionAuthority ? { role: 'LISTENER' as const, isMuted: true } : {}),
          },
        });
        if (left.count > 0) {
          await tx.user.updateMany({
            where: { id: userId, currentRoomId: roomId },
            data: { currentRoomId: null },
          });
          await tx.$executeRaw`UPDATE "Room" SET "participantCount" = GREATEST("participantCount" - 1, 0) WHERE id = ${roomId}`;
          await tx.roomHandRaise.deleteMany({ where: { roomId, userId } });
          const revocationTransitionId = randomUUID();
          await tx.outboxEvent.create({
            data: livekitRevocationOutboxData({ roomId, userId }, revocationTransitionId),
          });
          let roomRevocationTransitionId: string | null = null;
          let successorPermissionTransitionId: string | null = null;
          if (leavingHost && successor) {
            await tx.room.update({
              where: { id: roomId },
              data: { hostId: successor.userId },
            });
            await tx.participant.update({
              where: { id: successor.id },
              data: { role: 'HOST', isMuted: false },
            });
            successorPermissionTransitionId = randomUUID();
            await tx.outboxEvent.create({
              data: livekitRevocationOutboxData(
                { roomId, userId: successor.userId },
                successorPermissionTransitionId,
              ),
            });
          } else if (leavingHost) {
            const remainingUserIds = remaining.map(row => row.userId);
            await tx.room.update({
              where: { id: roomId },
              data: { isLive: false, endedAt: new Date(), participantCount: 0 },
            });
            await tx.participant.updateMany({
              where: { roomId, leftAt: null },
              data: { leftAt: new Date() },
            });
            if (remainingUserIds.length > 0) {
              await tx.user.updateMany({
                where: { id: { in: remainingUserIds }, currentRoomId: roomId },
                data: { currentRoomId: null },
              });
            }
            await tx.roomHandRaise.deleteMany({ where: { roomId } });
            roomRevocationTransitionId = randomUUID();
            await tx.outboxEvent.create({
              data: livekitRoomRevocationOutboxData(roomId, roomRevocationTransitionId),
            });
          }
          return {
            count: left.count,
            revocationTransitionId,
            successorUserId: successor?.userId ?? null,
            roomClosed: leavingHost && !successor,
            roomRevocationTransitionId,
            successorPermissionTransitionId,
            room: lockedRoom,
          };
        }
        return {
          count: 0,
          revocationTransitionId: null,
          successorUserId: null,
          roomClosed: false,
          roomRevocationTransitionId: null,
          successorPermissionTransitionId: null,
          room: lockedRoom,
        };
      }),
    );
    autoClosed = res.roomClosed;
    roomRevocationTransitionId = res.roomRevocationTransitionId;
    if (res.count > 0) {
      // ANO-09 fix: floor participantCount at 0 to prevent negative values
      // from concurrent leave/kick races.
      // HAND-05 fix: purge any pending hand-raise on leave so the FIFO queue
      // can't surface a user who already left (the head of the queue would
      // otherwise be unpromotable → USER_001). Only kick/lowerHand/setRole
      // cleared it before, never a plain leave.
      // ── Auto-promote: if the leaving user is the host, hand off ──
      const room = res.room;
      if (res.successorUserId) {
        emitRoomRoleChanged(roomId, { userId: res.successorUserId, role: 'HOST' });
      }
      if (res.successorPermissionTransitionId) {
        await scheduleBackgroundTask(
          wakeLivekitRevocation(res.successorPermissionTransitionId),
          err => logger.warn('rooms.leave: successor permission wake failed', { err, roomId }),
        );
      }
      if (res.roomClosed) {
        if (room.scheduledFor) {
          await cancelEventReminder(roomId).catch(err =>
            logger.warn('rooms.leave: cancel reminder failed', { err, roomId }),
          );
        }
        if (!room.isPrivate && room.roomType === 'OPEN') emitHallwayRoomClosed(roomId);
        emitRoomEnded(roomId);
        await scheduleBackgroundTask(recordingsService.stopForRoom(roomId), err =>
          logger.warn('rooms.leave: recording stop failed', { err, roomId }),
        );
      }

      // A room Participant is account-scoped. Once its committed row is left,
      // evict every device for that account and tear down both media backends.
      // This also makes the REST leave path authoritative when no socket event
      // follows it.
      forceUserSocketsLeaveRoom(roomId, userId);
      closeTransportsForUserInRoom(roomId, userId);
      if (res.revocationTransitionId) {
        await scheduleBackgroundTask(wakeLivekitRevocation(res.revocationTransitionId), err =>
          logger.warn('rooms.leave: LiveKit revocation wake failed', { err, roomId }),
        );
      }
      emitRoomUserLeft(roomId, userId);
      await emitMapUserUpdate({ userId, isInRoom: false });

      if (autoClosed) {
        await closeSfuRoom(roomId);
        if (roomRevocationTransitionId) {
          await scheduleBackgroundTask(wakeLivekitRoomRevocation(roomId), err =>
            logger.warn('rooms.leave: LiveKit room revocation wake failed', { err, roomId }),
          );
        }
        forceAllSocketsLeaveRoom(roomId);
      } else {
        const current = await prisma.room.findUnique({
          where: { id: roomId },
          select: { participantCount: true, isPrivate: true, roomType: true },
        });
        if (current && !current.isPrivate && current.roomType === 'OPEN') {
          emitHallwayRoomUpdated(roomId, { participantCount: current.participantCount });
        }
      }
    }
    return { left: true, changed: res.count > 0, roomClosed: autoClosed };
  },

  async end(roomId: string, userId: string) {
    const closure = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
          const room = await tx.room.findUnique({ where: { id: roomId } });
          if (!room) throw new AppError('ROOM_001');
          if (room.endedAt) throw new AppError('ROOM_004');
          if (room.hostId !== userId) throw new AppError('ROOM_003');

          const activeParticipants = await tx.participant.findMany({
            where: { roomId, leftAt: null },
            select: { userId: true },
          });
          const userIds = activeParticipants.map(participant => participant.userId);
          await lockUserRows(tx, userIds);
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
          const revocationTransitionId = randomUUID();
          await tx.outboxEvent.create({
            data: livekitRoomRevocationOutboxData(roomId, revocationTransitionId),
          });
          return { room, revocationTransitionId };
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );
    const room = closure.room;
    // Drop any pending reminder — the room is over.
    if (room.scheduledFor) await cancelEventReminder(roomId);
    if (!room.isPrivate && room.roomType === 'OPEN') {
      emitHallwayRoomClosed(roomId);
    }
    // Resolve the closer's display name so participants' clients can show *who*
    // ended the room. displayName ?? username is the repo-wide convention.
    const closer = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, username: true },
    });
    const endedByName = closer?.displayName ?? closer?.username ?? null;
    // Tell participants still in the room to leave for both REST and Socket.IO
    // callers; lifecycle fan-out is centralized here to avoid duplicate emits.
    emitRoomEnded(roomId, { endedBy: userId, endedByName });
    await closeSfuRoom(roomId);
    await scheduleBackgroundTask(wakeLivekitRoomRevocation(roomId), err =>
      logger.warn('rooms.end: LiveKit room revocation wake failed', { err, roomId }),
    );
    forceAllSocketsLeaveRoom(roomId);
    // Stop + finalize the Replay recording if one is running (gated/no-op).
    await scheduleBackgroundTask(recordingsService.stopForRoom(roomId), err =>
      logger.warn('rooms.end: recording stop failed', { err, roomId }),
    );
    return { ended: true };
  },

  async setRole(roomId: string, hostUserId: string, input: UpdateRoleInput) {
    const atomicMutation: {
      changed: boolean;
      room: { title: string; hostId: string; maxSpeakers: number };
      transitionIds: string[];
      previousHostId: string | null;
    } = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
          const lockedRoom = await tx.room.findUnique({
            where: { id: roomId },
            select: {
              title: true,
              hostId: true,
              maxSpeakers: true,
              endedAt: true,
              isLive: true,
            },
          });
          if (!lockedRoom) throw new AppError('ROOM_001');
          if (lockedRoom.endedAt || !lockedRoom.isLive) throw new AppError('ROOM_004');
          await lockUserRows(tx, [hostUserId, input.userId, lockedRoom.hostId]);
          const [caller, target] = await Promise.all([
            tx.participant.findUnique({
              where: { userId_roomId: { userId: hostUserId, roomId } },
              select: { role: true, leftAt: true },
            }),
            tx.participant.findUnique({
              where: { userId_roomId: { userId: input.userId, roomId } },
              select: { id: true, role: true, leftAt: true },
            }),
          ]);
          const callerAuthorized =
            lockedRoom.hostId === hostUserId ||
            (!!caller && !caller.leftAt && caller.role === 'MODERATOR');
          if (!callerAuthorized) throw new AppError('ROOM_003');
          if (!target || target.leftAt) throw new AppError('USER_001');
          if (input.userId === lockedRoom.hostId && input.role !== 'HOST') {
            throw new AppError('ROOM_003');
          }
          if (
            (input.role === 'HOST' || input.role === 'MODERATOR') &&
            lockedRoom.hostId !== hostUserId
          ) {
            throw new AppError('ROOM_003');
          }
          const roomResult = {
            title: lockedRoom.title,
            hostId: lockedRoom.hostId,
            maxSpeakers: lockedRoom.maxSpeakers,
          };
          if (
            target.role === input.role &&
            (input.role !== 'HOST' || lockedRoom.hostId === input.userId)
          ) {
            return {
              changed: false,
              room: roomResult,
              transitionIds: [] as string[],
              previousHostId: null,
            };
          }
          if (input.role === 'SPEAKER') {
            const activeSpeakers = await tx.participant.count({
              where: { roomId, leftAt: null, role: 'SPEAKER' },
            });
            if (activeSpeakers >= lockedRoom.maxSpeakers) throw new AppError('ROOM_002');
          }

          let previousHostId: string | null = null;
          if (input.role === 'HOST') {
            previousHostId = lockedRoom.hostId;
            await tx.room.update({ where: { id: roomId }, data: { hostId: input.userId } });
            await tx.participant.update({
              where: { id: target.id },
              data: { role: 'HOST', isMuted: false },
            });
            if (previousHostId !== input.userId) {
              await tx.participant.updateMany({
                where: { roomId, userId: previousHostId, leftAt: null },
                data: { role: 'SPEAKER' },
              });
            }
          } else {
            await tx.participant.update({
              where: { id: target.id },
              data: {
                role: input.role,
                ...(input.role === 'LISTENER' ? { isMuted: true } : {}),
              },
            });
          }
          if (input.role === 'SPEAKER') {
            await tx.roomHandRaise.deleteMany({ where: { roomId, userId: input.userId } });
          }
          const affectedUserIds = [
            input.userId,
            ...(previousHostId && previousHostId !== input.userId ? [previousHostId] : []),
          ];
          const transitionIds = affectedUserIds.map(() => randomUUID());
          await tx.outboxEvent.createMany({
            data: affectedUserIds.map((affectedUserId, index) =>
              livekitRevocationOutboxData(
                { roomId, userId: affectedUserId },
                transitionIds[index] as string,
              ),
            ),
          });
          return {
            changed: true,
            room: roomResult,
            transitionIds,
            previousHostId,
          };
        },
        { maxWait: 5_000, timeout: 10_000, isolationLevel: 'Serializable' },
      ),
    );
    if (!atomicMutation.changed) return { userId: input.userId, role: input.role };
    if (atomicMutation.previousHostId && atomicMutation.previousHostId !== input.userId) {
      emitRoomRoleChanged(roomId, {
        userId: atomicMutation.previousHostId,
        role: 'SPEAKER',
      });
    }
    if (input.role === 'SPEAKER') {
      emitRoomHandLowered(roomId, input.userId);
      await scheduleBackgroundTask(
        notificationsService.create({
          userId: input.userId,
          type: 'HAND_ACCEPTED',
          title: 'You are on stage',
          body: `"${atomicMutation.room.title}" â€” tap to unmute`,
          data: { roomId },
        }),
        err =>
          logger.warn('rooms.role: hand accepted notification failed', {
            err,
            roomId,
            userId: input.userId,
          }),
      );
    }
    emitRoomRoleChanged(roomId, { userId: input.userId, role: input.role });
    for (const transitionId of atomicMutation.transitionIds) {
      await scheduleBackgroundTask(wakeLivekitRevocation(transitionId), err =>
        logger.warn('rooms.role: LiveKit permission wake failed', { err, roomId }),
      );
    }
    return { userId: input.userId, role: input.role };
  },

  async setMute(roomId: string, callerUserId: string, input: MuteInput) {
    // Self-mute is always allowed; muting another user requires host or
    // moderator privileges. The host themselves cannot be muted by a mod.
    const targetUserId = input.userId ?? callerUserId;
    if (targetUserId !== callerUserId) {
      const room = await requireHostOrMod(roomId, callerUserId);
      if (room.hostId === targetUserId) throw new AppError('ROOM_009');
    } else {
      // PART-07 fix: self-mute must also be rejected in an ended room. The
      // host/mod path above already rejects via requireHostOrMod (ROOM_004);
      // the self path previously skipped any room-state check, letting users
      // toggle their mute flag in a room that no longer exists.
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { endedAt: true, isLive: true },
      });
      if (!room) throw new AppError('ROOM_001');
      if (room.endedAt || !room.isLive) throw new AppError('ROOM_004');
    }
    const mutation = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
        const lockedRoom = await tx.room.findUnique({
          where: { id: roomId },
          select: { hostId: true, endedAt: true, isLive: true },
        });
        if (!lockedRoom) throw new AppError('ROOM_001');
        if (lockedRoom.endedAt || !lockedRoom.isLive) throw new AppError('ROOM_004');
        await lockUserRows(tx, [callerUserId, targetUserId, lockedRoom.hostId]);
        if (targetUserId !== callerUserId) {
          const caller = await tx.participant.findUnique({
            where: { userId_roomId: { userId: callerUserId, roomId } },
            select: { role: true, leftAt: true },
          });
          const authorized =
            lockedRoom.hostId === callerUserId ||
            (!!caller && !caller.leftAt && caller.role === 'MODERATOR');
          if (!authorized) throw new AppError('ROOM_003');
          if (lockedRoom.hostId === targetUserId) throw new AppError('ROOM_009');
        }
        const participant = await tx.participant.findUnique({
          where: { userId_roomId: { userId: targetUserId, roomId } },
          select: { leftAt: true, isMuted: true },
        });
        if (!participant || participant.leftAt) throw new AppError('ROOM_005');
        if (participant.isMuted === input.isMuted) {
          return { transitionId: null };
        }
        await tx.participant.update({
          where: { userId_roomId: { userId: targetUserId, roomId } },
          data: { isMuted: input.isMuted },
        });
        const transitionId = randomUUID();
        await tx.outboxEvent.create({
          data: livekitRevocationOutboxData({ roomId, userId: targetUserId }, transitionId),
        });
        return { transitionId };
      }),
    );
    emitRoomMuteChanged(roomId, { userId: targetUserId, isMuted: input.isMuted });
    // Bridge the mic state to the map: a muted participant shows the red
    // mic-off badge, an unmuted one the green speaking badge. Only stage
    // participants are mutable, so this is never a listener.
    await emitMapUserUpdate({
      userId: targetUserId,
      isMuted: input.isMuted,
      isSpeaking: !input.isMuted,
      isListener: false,
    });
    if (mutation.transitionId) {
      await scheduleBackgroundTask(wakeLivekitRevocation(mutation.transitionId), err =>
        logger.warn('rooms.mute: LiveKit permission wake failed', { err, roomId }),
      );
    }
    return { userId: targetUserId, isMuted: input.isMuted };
  },

  async rsvp(roomId: string, userId: string) {
    const room = await prisma.room.findFirst({
      where: {
        AND: [{ id: roomId }, roomMetadataAccessWhere(userId)],
      },
    });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) throw new AppError('ROOM_004');
    // RSVP only makes sense for a scheduled room that hasn't started. For a
    // live room the user should just join.
    // EVEN-02 fix: gate on isLive, not only `scheduledFor`. go-live never
    // clears scheduledFor, so a started event still carries it — the old
    // `!scheduledFor` check let users RSVP to a room that's already live.
    if (!room.scheduledFor || room.isLive) throw new AppError('ROOM_004');

    await prisma.roomRsvp.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId },
      update: {},
    });
    return { rsvped: true as const };
  },

  async cancelRsvp(roomId: string, userId: string) {
    // EVEN-07 fix: surface the real removed count instead of always reporting
    // success. Cancelling an RSVP that never existed (or on a room that's
    // gone) previously returned `cancelled:true`, masking the no-op from the
    // client; now `cancelled` reflects whether a row was actually deleted.
    const res = await prisma.roomRsvp.deleteMany({ where: { roomId, userId } });
    return { cancelled: res.count > 0, removed: res.count };
  },

  async listRsvps(roomId: string, viewerId: string, opts?: { limit?: number; cursor?: string }) {
    const room = await prisma.room.findFirst({
      where: {
        AND: [{ id: roomId }, roomMetadataAccessWhere(viewerId)],
      },
      select: { id: true },
    });
    if (!room) throw new AppError('ROOM_001');

    // Cursor pagination so a room with tens of thousands of RSVPs doesn't
    // return everything in one shot. `cursor` is a RoomRsvp id.
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 100));
    const cursor = opts?.cursor;
    const blocked = await getBlockedIdSet(viewerId);
    const rows = await prisma.roomRsvp.findMany({
      where: {
        roomId,
        userId: blocked.size > 0 ? { notIn: [...blocked] } : undefined,
        user: { deletedAt: null },
      },
      include: { user: { select: publicUser } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    return rows.map(r => r.user);
  },

  async myUpcomingEvents(userId: string) {
    // Rooms the user is hosting OR RSVP'd to, scheduled in the future.
    return prisma.room.findMany({
      where: {
        AND: [roomMetadataAccessWhere(userId)],
        endedAt: null,
        scheduledFor: { gte: new Date() },
        host: { deletedAt: null },
        OR: [{ hostId: userId }, { rsvps: { some: { userId } } }],
      },
      orderBy: { scheduledFor: 'asc' },
      include: roomInclude,
    });
  },

  /**
   * Public scheduled rooms a user is HOSTING — surfaced on their profile so
   * visitors can see (and RSVP to) their upcoming events. Private rooms and
   * RSVP-only attendance are excluded (those are the viewer's own concern).
   */
  async userHostedUpcoming(userId: string, viewerId: string) {
    return prisma.room.findMany({
      where: {
        AND: [discoverableRoomWhere(viewerId)],
        hostId: userId,
        endedAt: null,
        scheduledFor: { gte: new Date() },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 10,
      include: roomInclude,
    });
  },

  /**
   * The user's hosting history — rooms they hosted that have ended.
   * Ordered by `endedAt desc` so the most recent is first. Powers the
   * "Rooms récentes" section on MyProfile.
   */
  async myRoomHistory(userId: string, limit = 20) {
    return prisma.room.findMany({
      where: {
        hostId: userId,
        endedAt: { not: null },
      },
      orderBy: { endedAt: 'desc' },
      take: limit,
      include: roomInclude,
    });
  },

  /**
   * Personalised Hallway feed. Pulls a bounded window of the newest live
   * public rooms, growing it as the client paginates, then scores each room:
   *
   *   score = 3 × (follow speakers in the room)
   *         + 2 × (interest tags shared with topic)
   *         + 1 × (listener count, scaled)
   *
   * Ordered by score desc then createdAt desc. The bounded in-memory
   * scoring is fine at this scale — 200 rooms × ~50 participants ≈ 10k
   * records, well under a millisecond. If we ever approach that ceiling
   * move the follow/interest joins into a materialised view before raising it.
   */
  async feed(
    viewerId: string,
    limit = 20,
    offset = 0,
    filters: { topic?: string; following?: boolean; clubs?: boolean } = {},
  ) {
    return getPersonalizedRoomFeed(viewerId, limit, offset, filters);
  },

  // ──────────────────────────── Hand-raise queue ──────────────────────────
  // The queue is FIFO (ordered by `raisedAt`). Hosts pop the head by
  // promoting the user via `setRole(SPEAKER)` which auto-clears the row.

  async raiseHand(roomId: string, userId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt || !room.isLive) throw new AppError('ROOM_004');
    await requireActiveParticipant(roomId, userId);

    // #36: enforce the host's hand-raise restriction. Default 'everyone' allows
    // all; 'followers' requires following the host; 'none' disables it entirely.
    const allowed = await canRaiseHandUnderRoomSettings(roomId, userId, room.hostId);
    if (!allowed) throw new AppError('ROOM_003', 'Hand-raising is restricted in this room');

    await prisma.roomHandRaise.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId },
      update: {},
    });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });
    if (user) emitRoomHandRaised(roomId, user);
    return { raised: true as const };
  },

  async lowerHand(roomId: string, userId: string) {
    // HAND-06 fix: require active membership and only broadcast when a row was
    // actually removed. Previously any authenticated caller — even a
    // non-participant, or a user who never raised a hand — could spam
    // room:hand_lowered to everyone in the room.
    await requireActiveParticipant(roomId, userId);
    const res = await prisma.roomHandRaise.deleteMany({ where: { roomId, userId } });
    if (res.count > 0) emitRoomHandLowered(roomId, userId);
    return { lowered: true as const };
  },

  // #3: a host/moderator *declines* a pending speak request. Removes the
  // target's hand-raise from the queue and broadcasts room:hand_lowered so the
  // listener's UI and every moderator's queue clear. Distinct from lowerHand,
  // which only ever lowers the caller's *own* hand — this is the moderator-side
  // "refuse" that mirrors the "accept" path (promote to SPEAKER).
  async dismissHandRaise(roomId: string, callerUserId: string, targetUserId: string) {
    const res = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        await requireHostOrModLocked(tx, roomId, callerUserId);
        return tx.roomHandRaise.deleteMany({ where: { roomId, userId: targetUserId } });
      }),
    );
    if (res.count > 0) emitRoomHandLowered(roomId, targetUserId);
    return { dismissed: res.count > 0 };
  },

  async listHandRaises(roomId: string, viewerId: string) {
    await requireActiveParticipant(roomId, viewerId);
    const rows = await prisma.roomHandRaise.findMany({
      where: { roomId, user: { deletedAt: null } },
      include: { user: { select: publicUser } },
      orderBy: { raisedAt: 'asc' },
    });
    return rows.map(r => ({ ...r.user, raisedAt: r.raisedAt.toISOString() }));
  },

  // ──────────────────────────── Room text chat ────────────────────────────
  // Gated on room.chatEnabled; the sender must be an active participant
  // (speaker or listener — chat is open to everyone who's in the room).

  async sendRoomMessage(roomId: string, userId: string, input: SendRoomMessageInput) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt || !room.isLive) throw new AppError('ROOM_004');
    if (!room.chatEnabled) throw new AppError('ROOM_006');
    await requireActiveParticipant(roomId, userId);

    // MODS_ONLY: only host + moderators can post (and read — list is gated
    // identically). Listeners get a clean ROOM_006 if they somehow probe
    // the endpoint with the chat hidden client-side.
    if (room.chatVisibility === 'MODS_ONLY') {
      const me = await prisma.participant.findUnique({
        where: { userId_roomId: { userId, roomId } },
        select: { role: true },
      });
      if (room.hostId !== userId && (!me || me.role !== 'MODERATOR')) {
        throw new AppError('ROOM_006');
      }
    }

    // Validate the reply target belongs to the same room — prevents
    // cross-room threading and dangling pointers if the client sends a
    // stale id from another room.
    if (input.replyToId) {
      const parent = await prisma.roomChatMessage.findUnique({
        where: { id: input.replyToId },
        select: { roomId: true, isDeleted: true },
      });
      if (!parent || parent.roomId !== roomId || parent.isDeleted) {
        throw new AppError('CHAT_002');
      }
    }

    const msg = await prisma.roomChatMessage.create({
      data: {
        roomId,
        userId,
        content: input.content,
        replyToId: input.replyToId ?? null,
      },
      include: {
        user: { select: publicUser },
        replyTo: {
          select: { id: true, content: true, user: { select: publicUser } },
        },
      },
    });
    emitRoomMessage(roomId, {
      id: msg.id,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      user: msg.user,
      replyTo: msg.replyTo
        ? {
            id: msg.replyTo.id,
            content: msg.replyTo.content,
            user: msg.replyTo.user,
          }
        : null,
    });
    return msg;
  },

  async listRoomMessages(roomId: string, viewerId: string, limit = 50) {
    await requireActiveParticipant(roomId, viewerId);
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { chatVisibility: true, hostId: true },
    });
    if (!room) throw new AppError('ROOM_001');
    // Mirror the send-side gate: MODS_ONLY hides the history from
    // listeners. They get an empty list, not a 403 — the UI can render
    // "Only moderators can chat here" without erroring.
    if (room.chatVisibility === 'MODS_ONLY') {
      const me = await prisma.participant.findUnique({
        where: { userId_roomId: { userId: viewerId, roomId } },
        select: { role: true },
      });
      if (room.hostId !== viewerId && (!me || me.role !== 'MODERATOR')) {
        return [];
      }
    }
    const rows = await prisma.roomChatMessage.findMany({
      where: { roomId, isDeleted: false, user: { deletedAt: null } },
      include: {
        user: { select: publicUser },
        replyTo: {
          select: { id: true, content: true, user: { select: publicUser } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.reverse();
  },

  // ──────────────────────────── Reactions ─────────────────────────────────
  // Float-up emoji. Persisted for moderation/analytics; the room socket
  // handler broadcasts them so clients can animate.

  async sendReaction(roomId: string, userId: string, input: SendReactionInput) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt || !room.isLive) throw new AppError('ROOM_004');
    await requireActiveParticipant(roomId, userId);

    const row = await prisma.roomReaction.create({
      data: { roomId, userId, emoji: input.emoji },
      include: { user: { select: { id: true, username: true, avatarUrl: true } } },
    });
    emitRoomReaction(roomId, {
      userId,
      emoji: row.emoji,
      createdAt: row.createdAt.toISOString(),
    });
    return row;
  },

  // ──────────────────────────── Kick ────────────────────────────────────
  // Host or moderator can kick a participant. Sets leftAt, clears
  // currentRoomId, and installs a RoomBan so the user can't immediately
  // re-join. Cannot kick the host.

  async kick(
    roomId: string,
    callerUserId: string,
    targetUserId: string,
    options: { banMinutes?: number; reason?: string } = {},
  ) {
    const minutes = options.banMinutes ?? DEFAULT_KICK_BAN_MINUTES;
    const expiresAt = minutes === 0 ? null : new Date(Date.now() + minutes * MS_PER_MINUTE);

    // Install ban so they can't bounce right back. banMinutes=0 → permanent.
    // Default 30 min keeps the friction proportionate to the offense.
    const mutation = await runWriteWithRetry(() =>
      prisma.$transaction(
        async tx => {
          // Join, leave and kick serialize in the same Room -> User order.
          // Presence, count, ban and provider hand-off commit together.
          await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${targetUserId} FOR UPDATE`;
          const lockedRoom = await tx.room.findUnique({
            where: { id: roomId },
            select: { hostId: true, endedAt: true, isPrivate: true, roomType: true },
          });
          if (!lockedRoom) throw new AppError('ROOM_001');
          if (lockedRoom.endedAt) throw new AppError('ROOM_004');

          if (lockedRoom.hostId !== callerUserId) {
            const caller = await tx.participant.findUnique({
              where: { userId_roomId: { userId: callerUserId, roomId } },
              select: { role: true, leftAt: true },
            });
            if (!caller || caller.leftAt || caller.role !== 'MODERATOR') {
              throw new AppError('ROOM_003');
            }
          }
          if (lockedRoom.hostId === targetUserId) throw new AppError('ROOM_003');
          if (callerUserId === targetUserId) throw new AppError('USER_003');

          const revoked = await tx.participant.updateMany({
            where: { roomId, userId: targetUserId, leftAt: null },
            // A punitive removal always revokes stage/moderation authority.
            // When a finite ban expires, rejoin must start as a muted listener.
            data: { leftAt: new Date(), role: 'LISTENER', isMuted: true },
          });
          if (revoked.count === 0) throw new AppError('ROOM_005');

          await tx.user.updateMany({
            where: { id: targetUserId, currentRoomId: roomId },
            data: { currentRoomId: null },
          });
          const updatedRooms = await tx.$queryRaw<{ participantCount: number }[]>`
            UPDATE "Room"
            SET "participantCount" = GREATEST("participantCount" - 1, 0)
            WHERE id = ${roomId}
            RETURNING "participantCount"`;
          await tx.roomHandRaise.deleteMany({ where: { roomId, userId: targetUserId } });
          await tx.roomBan.upsert({
            where: { roomId_userId: { roomId, userId: targetUserId } },
            create: {
              roomId,
              userId: targetUserId,
              bannedBy: callerUserId,
              reason: options.reason ?? null,
              expiresAt,
            },
            update: {
              bannedBy: callerUserId,
              reason: options.reason ?? null,
              expiresAt,
            },
          });

          const revocationTransitionId = randomUUID();
          await tx.outboxEvent.create({
            data: livekitRevocationOutboxData(
              { roomId, userId: targetUserId },
              revocationTransitionId,
            ),
          });
          return {
            ...lockedRoom,
            participantCount: updatedRooms[0]?.participantCount ?? 0,
            revocationTransitionId,
          };
        },
        { maxWait: 5_000, timeout: 10_000 },
      ),
    );

    // MODE-06: audit the moderation action. record() swallows persistence
    // errors itself, so a failed write never breaks the kick.
    await auditLogService.record({
      actorId: callerUserId,
      action: 'ROOM_USER_KICKED',
      targetUserId,
      targetRoomId: roomId,
      targetType: 'room',
      targetId: roomId,
      metadata: { banMinutes: minutes, permanent: minutes === 0, reason: options.reason ?? null },
    });

    // Resolve the moderator's display name so the kicked user's client can show
    // *who* removed them (e.g. "Jane removed you from this room"). displayName ??
    // username is the repo-wide convention for a human-facing name (cf. pingUser).
    const kicker = await prisma.user.findUnique({
      where: { id: callerUserId },
      select: { displayName: true, username: true },
    });
    const kickedByName = kicker?.displayName ?? kicker?.username ?? null;

    emitRoomUserKicked(roomId, { userId: targetUserId, kickedBy: callerUserId, kickedByName });
    // Authoritatively evict the kicked user's socket(s) from the room channel —
    // the broadcast above only notifies; this enforces it server-side so a
    // client that ignores the event can't keep receiving room broadcasts.
    forceLeaveRoom(roomId, targetUserId, callerUserId, kickedByName);
    closeTransportsForUserInRoom(roomId, targetUserId);
    await scheduleBackgroundTask(wakeLivekitRevocation(mutation.revocationTransitionId), err => {
      logger.warn('rooms.kick: LiveKit revocation wake failed', { err, roomId });
    });
    if (!mutation.isPrivate && mutation.roomType === 'OPEN') {
      emitHallwayRoomUpdated(roomId, { participantCount: mutation.participantCount });
    }
    return { kicked: true as const };
  },

  // ──────────────────── Live room metadata ────────────────────────────
  async updateTitle(roomId: string, callerUserId: string, input: UpdateRoomTitleInput) {
    const updated = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        await requireHostOrModLocked(tx, roomId, callerUserId);
        return tx.room.update({
          where: { id: roomId },
          data: { title: input.title },
          select: { id: true, title: true, isPrivate: true, roomType: true },
        });
      }),
    );
    emitRoomMetaUpdated(roomId, { title: updated.title });
    if (!updated.isPrivate && updated.roomType === 'OPEN') {
      emitHallwayRoomUpdated(roomId, { title: updated.title });
    }
    return { title: updated.title };
  },

  // #34: lock/unlock the room. Host/mod only. Broadcast so every client can
  // reflect the locked badge; the join guard enforces it server-side.
  async setLock(roomId: string, callerUserId: string, locked: boolean) {
    await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        await requireHostOrModLocked(tx, roomId, callerUserId);
        await tx.room.update({ where: { id: roomId }, data: { isLocked: locked } });
      }),
    );
    emitRoomMetaUpdated(roomId, { isLocked: locked });
    return { isLocked: locked };
  },

  // #14: flip a room between public and private after creation (host only —
  // it's a fundamental room property, unlike lock/title which mods can touch).
  // The hallway listing only ever holds public, live rooms, so mirror the flip
  // there: going private removes it, going public (re)adds it. Members of the
  // room learn via room:meta_updated so they can reflect the privacy badge.
  async setPrivacy(roomId: string, callerUserId: string, isPrivate: boolean) {
    const { current, updated } = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        const current = await requireHostLocked(tx, roomId, callerUserId);
        const roomType = isPrivate
          ? ('CLOSED' as const)
          : current.roomType === 'CLOSED'
            ? ('OPEN' as const)
            : current.roomType;
        const updated = await tx.room.update({
          where: { id: roomId },
          data: { isPrivate, roomType },
          select: {
            id: true,
            title: true,
            hostId: true,
            clubId: true,
            isLive: true,
            isPrivate: true,
            roomType: true,
            scheduledFor: true,
            createdAt: true,
          },
        });
        return { current, updated };
      }),
    );
    emitRoomMetaUpdated(roomId, {
      isPrivate: updated.isPrivate,
      roomType: updated.roomType,
    });
    if (updated.isLive) {
      if (updated.isPrivate) {
        if (!current.isPrivate && current.roomType === 'OPEN') {
          emitHallwayRoomClosed(roomId);
        }
      } else if (updated.roomType === 'OPEN') {
        emitHallwayRoomCreated({
          id: updated.id,
          title: updated.title,
          hostId: updated.hostId,
          clubId: updated.clubId,
          isLive: updated.isLive,
          scheduledFor: updated.scheduledFor ? updated.scheduledFor.toISOString() : null,
          createdAt: updated.createdAt.toISOString(),
        });
      }
    }
    return { isPrivate: updated.isPrivate };
  },

  async toggleChat(roomId: string, callerUserId: string, input: ToggleRoomChatInput) {
    const data: { chatEnabled?: boolean; chatVisibility?: 'ALL' | 'MODS_ONLY' } = {};
    if (typeof input.chatEnabled === 'boolean') data.chatEnabled = input.chatEnabled;
    if (input.chatVisibility) {
      data.chatVisibility = input.chatVisibility === 'mods' ? 'MODS_ONLY' : 'ALL';
    }
    if (Object.keys(data).length === 0) {
      throw new AppError('VALIDATION_001');
    }
    const updated = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        await requireHostOrModLocked(tx, roomId, callerUserId);
        return tx.room.update({
          where: { id: roomId },
          data,
          select: { chatEnabled: true, chatVisibility: true },
        });
      }),
    );
    emitRoomMetaUpdated(roomId, {
      chatEnabled: updated.chatEnabled,
      chatVisibility: updated.chatVisibility,
    });
    return updated;
  },

  /**
   * Host-only "mute everyone" — flips isMuted on every active speaker
   * (and optionally the host themselves). Each affected participant gets
   * a `room:mute-changed` broadcast so their UI flips synchronously.
   */
  async muteAll(roomId: string, callerUserId: string, input: MuteAllInput) {
    await requireHostOrMod(roomId, callerUserId);
    const roleIn: Prisma.ParticipantWhereInput['role'] = {
      in: input.includeHost ? ['HOST', 'MODERATOR', 'SPEAKER'] : ['MODERATOR', 'SPEAKER'],
    };
    // Read-then-update on the same userIds so the broadcast list matches
    // the rows we mutated (a speaker who joined between the two calls
    // wouldn't be in `targets` AND wouldn't have been touched).
    const targets = await runWriteWithRetry(() =>
      prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;
        const lockedRoom = await tx.room.findUnique({
          where: { id: roomId },
          select: { hostId: true, endedAt: true, isLive: true },
        });
        if (!lockedRoom) throw new AppError('ROOM_001');
        if (lockedRoom.endedAt || !lockedRoom.isLive) throw new AppError('ROOM_004');
        const rows = await tx.participant.findMany({
          where: { roomId, leftAt: null, isMuted: false, role: roleIn },
          select: { userId: true },
        });
        await lockUserRows(tx, [callerUserId, lockedRoom.hostId, ...rows.map(row => row.userId)]);
        const caller = await tx.participant.findUnique({
          where: { userId_roomId: { userId: callerUserId, roomId } },
          select: { role: true, leftAt: true },
        });
        const authorized =
          lockedRoom.hostId === callerUserId ||
          (!!caller && !caller.leftAt && caller.role === 'MODERATOR');
        if (!authorized) throw new AppError('ROOM_003');
        if (rows.length === 0) return [];
        await tx.participant.updateMany({
          where: {
            roomId,
            userId: { in: rows.map(row => row.userId) },
            leftAt: null,
            isMuted: false,
          },
          data: { isMuted: true },
        });
        const transitions = rows.map(row => ({ ...row, transitionId: randomUUID() }));
        await tx.outboxEvent.createMany({
          data: transitions.map(transition =>
            livekitRevocationOutboxData(
              { roomId, userId: transition.userId },
              transition.transitionId,
            ),
          ),
        });
        return transitions;
      }),
    );
    if (targets.length === 0) return { mutedCount: 0 };
    for (const t of targets) {
      emitRoomMuteChanged(roomId, { userId: t.userId, isMuted: true });
      await scheduleBackgroundTask(wakeLivekitRevocation(t.transitionId), err =>
        logger.warn('rooms.muteAll: LiveKit permission wake failed', { err, roomId }),
      );
    }
    return { mutedCount: targets.length };
  },

  // ──────────────────── Invitation & ping ─────────────────────────────
  /**
   * Bulk-invite users to a room. Each invitee receives a ROOM_INVITE
   * notification + push. Closed rooms also get a pre-created Participant
   * row (LISTENER) so the join check in `join` lets them in.
   */
  async invite(roomId: string, callerUserId: string, input: InviteToRoomInput) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        title: true,
        hostId: true,
        isPrivate: true,
        roomType: true,
        endedAt: true,
      },
    });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) throw new AppError('ROOM_004');

    // Anyone in the room can invite to public rooms; closed rooms restrict
    // to host/mod (preserves the invite-only semantics).
    if (room.isPrivate || room.roomType === 'CLOSED') {
      await requireHostOrMod(roomId, callerUserId);
    } else {
      await requireActiveParticipant(roomId, callerUserId);
    }

    // Drop self-invites + dedup ids defensively.
    const targets = [...new Set(input.userIds.filter(id => id !== callerUserId))];
    if (targets.length === 0) return { invitedCount: 0 };

    // Verify users exist; silently prune unknown ids.
    const existing = await prisma.user.findMany({
      where: { id: { in: targets }, deletedAt: null },
      select: { id: true },
    });
    const [callerBlocked, hostBlocked] = await Promise.all([
      getBlockedIdSet(callerUserId),
      callerUserId === room.hostId
        ? Promise.resolve(new Set<string>())
        : getBlockedIdSet(room.hostId),
    ]);
    let validIds = existing
      .map(user => user.id)
      .filter(userId => !callerBlocked.has(userId) && !hostBlocked.has(userId));

    // SOCIAL-room notifications must not disclose the room to users who
    // cannot open or join it. Existing participants and accepted followers of
    // the host remain eligible.
    if (room.roomType === 'SOCIAL' && validIds.length > 0) {
      const [accepted, admitted] = await Promise.all([
        prisma.follow.findMany({
          where: {
            followerId: { in: validIds },
            followingId: room.hostId,
            status: 'ACCEPTED',
          },
          select: { followerId: true },
        }),
        prisma.participant.findMany({
          where: { roomId, userId: { in: validIds }, leftAt: null },
          select: { userId: true },
        }),
      ]);
      const allowed = new Set([
        ...accepted.map(follow => follow.followerId),
        ...admitted.map(participant => participant.userId),
      ]);
      validIds = validIds.filter(userId => allowed.has(userId));
    }

    // Closed rooms: pre-seat invitees as LISTENER so the join guard accepts
    // them. Two bulk queries (createMany skipDuplicates + updateMany to
    // un-leave re-invites) instead of N upserts — avoids up to 50 DB
    // round-trips when inviting the full batch.
    if ((room.isPrivate || room.roomType === 'CLOSED') && validIds.length > 0) {
      const invitedAt = new Date();
      await prisma.participant.createMany({
        data: validIds.map(userId => ({
          roomId,
          userId,
          role: 'LISTENER' as const,
          leftAt: invitedAt,
        })),
        skipDuplicates: true,
      });
    }

    await Promise.all(
      validIds.map(userId =>
        notificationsService.create({
          userId,
          actorId: callerUserId,
          type: 'ROOM_INVITE',
          title: "You're invited",
          body: `Join "${room.title}" — tap to enter`,
          data: { roomId, invitedBy: callerUserId },
          targetId: roomId,
          targetType: 'room',
        }),
      ),
    );
    return { invitedCount: validIds.length };
  },

  /**
   * Lightweight "ping a friend to come join" — a single-user variant of
   * invite that doesn't pre-seat them in the participant list. Best for
   * public rooms where the friend just clicks the notification to enter.
   */
  async pingUser(roomId: string, callerUserId: string, targetUserId: string) {
    if (callerUserId === targetUserId) throw new AppError('USER_003');
    await requireActiveParticipant(roomId, callerUserId);
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        title: true,
        endedAt: true,
        isPrivate: true,
        roomType: true,
      },
    });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) throw new AppError('ROOM_004');
    if (room.isPrivate || room.roomType === 'CLOSED') throw new AppError('ROOM_007');
    try {
      await assertRoomMetadataAccess(roomId, targetUserId);
    } catch (err) {
      if (err instanceof AppError && err.code === 'ROOM_001') {
        throw new AppError('ROOM_007');
      }
      throw err;
    }

    const sender = await prisma.user.findUnique({
      where: { id: callerUserId },
      select: { username: true, displayName: true },
    });
    const handle = sender?.displayName ?? sender?.username ?? 'A friend';

    await notificationsService.create({
      userId: targetUserId,
      actorId: callerUserId,
      type: 'ROOM_INVITE',
      title: handle,
      body: `${handle} pings you: "${room.title}"`,
      data: { roomId, ping: true, from: callerUserId },
      targetId: roomId,
      targetType: 'room',
    });
    return { pinged: true as const };
  },
};

/**
 * Guard: the caller must be a non-left participant of the room. Shared
 * across hand-raise / chat / reaction endpoints so the rule stays in
 * one place. Throws ROOM_005 when the caller isn't in the room.
 */
const requireActiveParticipant = async (roomId: string, userId: string) => {
  const p = await prisma.participant.findUnique({
    where: { userId_roomId: { userId, roomId } },
    select: { leftAt: true },
  });
  if (!p || p.leftAt) throw new AppError('ROOM_005');
};
