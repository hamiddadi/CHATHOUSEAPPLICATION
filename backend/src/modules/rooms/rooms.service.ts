import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { getBlockedIdSet } from '../social/blocks';
import { cancelEventReminder, scheduleEventReminder } from '../../queues/eventReminders';
import { fanoutOne } from '../../extensions/queues/followFanout';
import { logger } from '../../config/logger';
import {
  emitHallwayRoomClosed,
  emitHallwayRoomCreated,
  emitHallwayRoomUpdated,
  emitRoomHandLowered,
  emitRoomHandRaised,
  emitRoomMessage,
  emitRoomMetaUpdated,
  emitRoomMuteChanged,
  emitRoomReaction,
  emitRoomRoleChanged,
  emitRoomUserKicked,
} from '../../socket/realtime';
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

// Hallway feed scoring weights (see `feed()` doc): a followed speaker is
// worth more than a topic match, which beats raw popularity.
const FOLLOW_SPEAKER_WEIGHT = 3;
const TOPIC_MATCH_WEIGHT = 2;
const POPULARITY_CAP = 5;
const POPULARITY_BUCKET = 10;

const roomInclude = {
  host: { select: publicUser },
  participants: { include: { user: { select: publicUser } }, where: { leftAt: null } },
  club: { select: { id: true, name: true, iconUrl: true } },
  _count: { select: { rsvps: true } },
} satisfies Prisma.RoomInclude;

const requireHost = async (roomId: string, userId: string) => {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new AppError('ROOM_001');
  if (room.endedAt) throw new AppError('ROOM_004');
  if (room.hostId !== userId) throw new AppError('ROOM_003');
  return room;
};

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
  if (!p || p.leftAt || (p.role !== 'MODERATOR' && p.role !== 'HOST')) {
    throw new AppError('ROOM_003');
  }
  return room;
};

export const roomsService = {
  async list(input: ListRoomsInput) {
    // Default `filter` falls back to the legacy `live` flag so existing
    // callers keep working without code changes.
    const effectiveFilter = input.filter ?? (input.live === false ? undefined : 'live');

    // 'past' lists ended rooms (e.g. a club's room archive) — so it must
    // invert the default endedAt:null guard and instead require endedAt set.
    const isPast = effectiveFilter === 'past';

    const where: Prisma.RoomWhereInput = {
      ...(isPast ? { endedAt: { not: null } } : { endedAt: null }),
      isPrivate: false,
      ...(input.clubId ? { clubId: input.clubId } : {}),
    };
    if (effectiveFilter === 'live') where.isLive = true;
    if (effectiveFilter === 'upcoming') where.scheduledFor = { gte: new Date() };

    const orderBy: Prisma.RoomOrderByWithRelationInput = isPast
      ? { endedAt: 'desc' }
      : effectiveFilter === 'upcoming'
        ? { scheduledFor: 'asc' }
        : { createdAt: 'desc' };

    return prisma.room.findMany({
      where,
      orderBy,
      take: input.limit,
      include: roomInclude,
    });
  },

  async create(hostId: string, input: CreateRoomInput) {
    // If the room is attached to a club, the host must be a member.
    if (input.clubId) {
      const membership = await prisma.clubMember.findUnique({
        where: { clubId_userId: { clubId: input.clubId, userId: hostId } },
      });
      if (!membership) throw new AppError('CLUB_002');
    }

    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
    const isLive = scheduledFor === null;

    // De-dupe + lowercase topics so the stored list is canonical and
    // matches how we score against User.interests (also lowercased).
    const normalisedTopics = [
      ...new Set(input.topics.map(t => t.trim().toLowerCase()).filter(Boolean)),
    ];

    // Drop the host id + duplicates from the co-host list. Validate the
    // users actually exist — silently prune unknown ids so an outdated
    // client can't crash the request.
    const requestedCoHosts = [...new Set(input.coHostIds.filter(id => id !== hostId))];
    let coHostIds: string[] = [];
    if (requestedCoHosts.length > 0) {
      const found = await prisma.user.findMany({
        where: { id: { in: requestedCoHosts } },
        select: { id: true },
      });
      coHostIds = found.map(u => u.id);
    }

    // No transaction: the host-participant insert is a best-effort follow-up
    // (upsert-idempotent on the unique userId_roomId index), and the outer
    // re-fetch pulls the authoritative state anyway. Avoids hitting Prisma's
    // 5s interactive-transaction ceiling on slow cold starts.
    const created = await prisma.room.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        topic: input.topic ?? null,
        topics: normalisedTopics,
        isPrivate: input.isPrivate,
        roomType: input.roomType ?? 'OPEN',
        chatEnabled: input.chatEnabled,
        // TODO(phase-N): recordingEnabled is a schema placeholder — no
        // server-side recording pipeline (S3/GCS + transcoding) exists yet.
        // Do NOT expose in client UI until the pipeline is implemented.
        recordingEnabled: input.recordingEnabled ?? false,
        maxSpeakers: input.maxSpeakers,
        hostId,
        clubId: input.clubId ?? null,
        scheduledFor,
        isLive,
        participantCount: isLive ? 1 + coHostIds.length : 0,
      },
    });
    // Scheduled rooms don't auto-add the host as participant — the host
    // joins when the room goes live like anyone else. Same for co-hosts:
    // they get the invite notification either way, but only get seated
    // as SPEAKER participants when the room is live.
    if (isLive) {
      await prisma.participant.create({
        data: { roomId: created.id, userId: hostId, role: 'HOST' },
      });
      if (coHostIds.length > 0) {
        await prisma.participant.createMany({
          data: coHostIds.map(userId => ({
            roomId: created.id,
            userId,
            role: 'SPEAKER' as const,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Fire ROOM_INVITE notifications to every co-host so they can jump
    // in immediately (or open the scheduled event's detail view).
    if (coHostIds.length > 0) {
      await Promise.all(
        coHostIds.map(userId =>
          notificationsService.create({
            userId,
            type: 'ROOM_INVITE',
            title: 'Co-host invite',
            body: `"${input.title}" — you're invited to co-host`,
            data: { roomId: created.id, hostId },
          }),
        ),
      );
    }
    const room = await prisma.room.findUnique({
      where: { id: created.id },
      include: roomInclude,
    });
    if (!room) throw new AppError('ROOM_001');

    if (scheduledFor) {
      await scheduleEventReminder(room.id, scheduledFor);
    }

    // Broadcast to everyone in the hallway if the room is immediately
    // live. Scheduled rooms surface via the upcoming feed and the BullMQ
    // reminder, so no hallway event on create.
    if (isLive && !input.isPrivate) {
      emitHallwayRoomCreated({
        id: room.id,
        title: room.title,
        hostId: room.hostId,
        clubId: room.clubId,
        isLive: room.isLive,
        scheduledFor: room.scheduledFor?.toISOString() ?? null,
        createdAt: room.createdAt.toISOString(),
      });

      // Fan out a "started a room" notification to the host's followers
      // immediately on create, rather than waiting up to 30s for the
      // periodic scan worker. fanoutOne is idempotent (Redis SET NX on the
      // same dedup key the scanner uses) so this never double-notifies even
      // when the worker also picks the room up. Best-effort: a failure here
      // must never block room creation, so we swallow + log and let the scan
      // worker retry on its next pass.
      void fanoutOne(room.id).catch(err =>
        logger.warn('rooms.create: follower fan-out failed', { err, roomId: room.id }),
      );
    }

    return room;
  },

  async get(roomId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: roomInclude });
    if (!room) throw new AppError('ROOM_001');
    return room;
  },

  async join(roomId: string, userId: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        _count: { select: { participants: { where: { leftAt: null, role: 'SPEAKER' } } } },
      },
    });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) throw new AppError('ROOM_004');
    // Scheduled rooms aren't joinable until they go live.
    if (!room.isLive) throw new AppError('ROOM_004');

    const existing = await prisma.participant.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });

    // CLOSED rooms (isPrivate=true) are invite-only. The host pre-creates
    // Participant rows for invitees on creation; anyone else gets rejected
    // even if they discovered the room id. The host themselves always passes.
    if (room.isPrivate && room.hostId !== userId && !existing) {
      throw new AppError('ROOM_007');
    }

    // SOCIAL rooms gate on the follow graph: anyone but the host or an
    // existing participant must already follow the host to get in. This
    // mirrors Clubhouse's "social" mode where rooms are open to the host's
    // network rather than the whole hallway.
    if (room.roomType === 'SOCIAL' && room.hostId !== userId && !existing) {
      const f = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: userId, followingId: room.hostId } },
      });
      if (!f) throw new AppError('ROOM_007');
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
    let wasAlreadyActive = false;
    if (existing) {
      if (existing.leftAt) {
        await prisma.participant.update({
          where: { id: existing.id },
          data: { leftAt: null, joinedAt: new Date() },
        });
      } else {
        wasAlreadyActive = true;
      }
    } else {
      await prisma.participant.create({
        data: { roomId, userId, role: 'LISTENER' },
      });
    }

    // Track current room + bump denormalized count
    if (!wasAlreadyActive) {
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { currentRoomId: roomId } }),
        prisma.room.update({ where: { id: roomId }, data: { participantCount: { increment: 1 } } }),
      ]);
      emitHallwayRoomUpdated(roomId, { participantCount: room.participantCount + 1 });
    }

    return roomsService.get(roomId);
  },

  async leave(roomId: string, userId: string) {
    const res = await prisma.participant.updateMany({
      where: { roomId, userId, leftAt: null },
      data: { leftAt: new Date() },
    });
    if (res.count > 0) {
      // Clear currentRoomId + decrement participant count
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { currentRoomId: null } }),
        prisma.room.update({ where: { id: roomId }, data: { participantCount: { decrement: 1 } } }),
      ]);

      // ── Auto-promote: if the leaving user is the host, hand off ──
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (room && !room.endedAt && room.hostId === userId) {
        // Pick next host: prefer MODERATOR, then SPEAKER, by joinedAt
        const successor = await prisma.participant.findFirst({
          where: {
            roomId,
            leftAt: null,
            userId: { not: userId },
            role: { in: ['MODERATOR', 'SPEAKER'] },
          },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        });
        if (successor) {
          await prisma.$transaction([
            prisma.room.update({ where: { id: roomId }, data: { hostId: successor.userId } }),
            prisma.participant.update({ where: { id: successor.id }, data: { role: 'HOST' } }),
          ]);
          emitRoomRoleChanged(roomId, { userId: successor.userId, role: 'HOST' });
        } else {
          // No eligible successor → check if any participant remains
          const anyRemaining = await prisma.participant.count({
            where: { roomId, leftAt: null, userId: { not: userId } },
          });
          if (anyRemaining === 0) {
            // Auto-close empty room
            await prisma.room.update({
              where: { id: roomId },
              data: { isLive: false, endedAt: new Date() },
            });
            await cancelEventReminder(roomId);
            emitHallwayRoomClosed(roomId);
          }
        }
      }
    }
    return { left: true };
  },

  async end(roomId: string, userId: string) {
    await requireHost(roomId, userId);
    // Collect active participant user ids before closing so we can clear currentRoomId
    const activeParticipants = await prisma.participant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    const userIds = activeParticipants.map(p => p.userId);

    await prisma.$transaction([
      prisma.participant.updateMany({
        where: { roomId, leftAt: null },
        data: { leftAt: new Date() },
      }),
      prisma.room.update({
        where: { id: roomId },
        data: { isLive: false, endedAt: new Date(), participantCount: 0 },
      }),
      // Clear currentRoomId for all participants
      ...(userIds.length > 0
        ? [
            prisma.user.updateMany({
              where: { id: { in: userIds } },
              data: { currentRoomId: null },
            }),
          ]
        : []),
    ]);
    // Drop any pending reminder — the room is over.
    await cancelEventReminder(roomId);
    emitHallwayRoomClosed(roomId);
    return { ended: true };
  },

  async setRole(roomId: string, hostUserId: string, input: UpdateRoleInput) {
    const room = await requireHostOrMod(roomId, hostUserId);

    // Only the actual host can transfer ownership.
    if (input.role === 'HOST' && room.hostId !== hostUserId) {
      throw new AppError('ROOM_003');
    }

    if (input.role === 'SPEAKER') {
      const activeSpeakers = await prisma.participant.count({
        where: { roomId, leftAt: null, role: 'SPEAKER' },
      });
      if (activeSpeakers >= room.maxSpeakers) throw new AppError('ROOM_002');
    }

    const updated = await prisma.participant.updateMany({
      where: { roomId, userId: input.userId, leftAt: null },
      data: { role: input.role },
    });
    if (updated.count === 0) throw new AppError('USER_001');

    // Transferring HOST must also flip Room.hostId and demote the previous
    // host to SPEAKER, otherwise requireHost() keeps protecting the old user
    // and the room ends up with two HOST participants.
    if (input.role === 'HOST' && room.hostId !== input.userId) {
      await prisma.$transaction([
        prisma.room.update({
          where: { id: roomId },
          data: { hostId: input.userId },
        }),
        prisma.participant.updateMany({
          where: { roomId, userId: room.hostId, leftAt: null },
          data: { role: 'SPEAKER' },
        }),
      ]);
      emitRoomRoleChanged(roomId, { userId: room.hostId, role: 'SPEAKER' });
    }

    // Promoting a listener to SPEAKER clears their hand-raise entry so
    // the queue doesn't grow stale, and fires a HAND_ACCEPTED
    // notification so the promoted user sees it if they happen to be
    // mid-scroll outside the room.
    if (input.role === 'SPEAKER') {
      await prisma.roomHandRaise.deleteMany({
        where: { roomId, userId: input.userId },
      });
      emitRoomHandLowered(roomId, input.userId);
      void notificationsService.create({
        userId: input.userId,
        type: 'HAND_ACCEPTED',
        title: 'You are on stage',
        body: `"${room.title}" — tap to unmute`,
        data: { roomId },
      });
    }

    emitRoomRoleChanged(roomId, { userId: input.userId, role: input.role });
    return { userId: input.userId, role: input.role };
  },

  async setMute(roomId: string, callerUserId: string, input: MuteInput) {
    // Self-mute is always allowed; muting another user requires host or
    // moderator privileges. The host themselves cannot be muted by a mod.
    const targetUserId = input.userId ?? callerUserId;
    if (targetUserId !== callerUserId) {
      const room = await requireHostOrMod(roomId, callerUserId);
      if (room.hostId === targetUserId) throw new AppError('ROOM_009');
    }
    const updated = await prisma.participant.updateMany({
      where: { roomId, userId: targetUserId, leftAt: null },
      data: { isMuted: input.isMuted },
    });
    if (updated.count === 0) throw new AppError('ROOM_005');
    emitRoomMuteChanged(roomId, { userId: targetUserId, isMuted: input.isMuted });
    return { userId: targetUserId, isMuted: input.isMuted };
  },

  async rsvp(roomId: string, userId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) throw new AppError('ROOM_004');
    // RSVP only makes sense for scheduled rooms; for live rooms the user
    // should just join. Reject to surface the confusion client-side.
    if (!room.scheduledFor) throw new AppError('ROOM_004');

    await prisma.roomRsvp.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId },
      update: {},
    });
    return { rsvped: true as const };
  },

  async cancelRsvp(roomId: string, userId: string) {
    await prisma.roomRsvp.deleteMany({ where: { roomId, userId } });
    return { cancelled: true as const };
  },

  async listRsvps(roomId: string, viewerId?: string, opts?: { limit?: number; cursor?: string }) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, hostId: true, isPrivate: true },
    });
    if (!room) throw new AppError('ROOM_001');

    // AuthZ: the full RSVP list of a private/closed room is only visible to
    // its host or an (active) participant — otherwise anyone who discovered
    // the id could enumerate who's attending a private event. Public rooms
    // stay open to any authenticated viewer.
    if (room.isPrivate && viewerId !== undefined && room.hostId !== viewerId) {
      const p = await prisma.participant.findUnique({
        where: { userId_roomId: { userId: viewerId, roomId } },
        select: { leftAt: true },
      });
      if (!p || p.leftAt) throw new AppError('ROOM_007');
    }

    // Cursor pagination so a room with tens of thousands of RSVPs doesn't
    // return everything in one shot. `cursor` is a RoomRsvp id.
    const limit = Math.max(1, Math.min(100, opts?.limit ?? 100));
    const cursor = opts?.cursor;
    const rows = await prisma.roomRsvp.findMany({
      where: { roomId },
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
        endedAt: null,
        scheduledFor: { gte: new Date() },
        OR: [{ hostId: userId }, { rsvps: { some: { userId } } }],
      },
      orderBy: { scheduledFor: 'asc' },
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
   * Personalised Hallway feed. Pulls the newest live public rooms
   * (capped at CANDIDATE_POOL) then scores each one for the viewer:
   *
   *   score = 3 × (follow speakers in the room)
   *         + 2 × (interest tags shared with topic)
   *         + 1 × (listener count, scaled)
   *
   * Ordered by score desc then createdAt desc. The simple in-memory
   * scoring is fine at this scale — 200 rooms × ~50 participants ≈ 10k
   * records, well under a millisecond. If we ever approach that ceiling
   * we'll move the follow/interest joins into a materialised view.
   */
  async feed(
    viewerId: string,
    limit = 20,
    _cursor?: string,
    filters: { topic?: string; following?: boolean; clubs?: boolean } = {},
  ) {
    const CANDIDATE_POOL = 200;
    const topicLower = filters.topic?.toLowerCase();

    const [viewer, followedIds, blockedIds, candidates] = await Promise.all([
      prisma.user.findUnique({
        where: { id: viewerId },
        select: { interests: true },
      }),
      prisma.follow
        .findMany({
          where: { followerId: viewerId },
          select: { followingId: true },
        })
        .then(rows => new Set(rows.map(r => r.followingId))),
      getBlockedIdSet(viewerId),
      prisma.room.findMany({
        where: {
          isLive: true,
          isPrivate: false,
          endedAt: null,
          // `clubs` filter narrows the pool to club-attached rooms only.
          ...(filters.clubs ? { clubId: { not: null } } : {}),
          ...(topicLower
            ? {
                OR: [
                  { topic: { equals: topicLower, mode: 'insensitive' } },
                  { topics: { has: topicLower } },
                  { title: { contains: topicLower, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: {
          host: { select: publicUser },
          participants: {
            where: { leftAt: null },
            include: { user: { select: publicUser } },
          },
          club: { select: { id: true, name: true, iconUrl: true } },
          _count: { select: { rsvps: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: CANDIDATE_POOL,
      }),
    ]);
    const interests = new Set((viewer?.interests ?? []).map(i => i.toLowerCase()));

    // Filter out rooms hosted by or only containing blocked users.
    // When `following` filter is on, also keep only rooms with at least
    // one followed speaker (or hosted by a followed user).
    const filteredCandidates = candidates.filter(room => {
      if (blockedIds.has(room.hostId)) return false;
      if (filters.following) {
        if (followedIds.has(room.hostId)) return true;
        return room.participants.some(p => p.role !== 'LISTENER' && followedIds.has(p.userId));
      }
      return true;
    });

    const scored = filteredCandidates.map(room => {
      const speakers = room.participants.filter(p => p.role !== 'LISTENER');
      const followSpeakerCount = speakers.filter(p => followedIds.has(p.userId)).length;

      // Structured topic match: intersect the room's topics[] with the
      // viewer's interests. Fall back to soft substring matching on
      // `topic + title` so rooms created before topics were wired still
      // score non-zero when the user types something relevant.
      let topicMatch = 0;
      const roomTopics = new Set((room.topics ?? []).map(t => t.toLowerCase()));
      for (const interest of interests) {
        if (roomTopics.has(interest)) topicMatch += 1;
      }
      if (topicMatch === 0) {
        const roomText = `${room.topic ?? ''} ${room.title}`.toLowerCase();
        for (const interest of interests) {
          if (interest.length >= 3 && roomText.includes(interest)) topicMatch += 1;
        }
      }

      const listenerCount = room.participants.length;
      const popularity = Math.min(POPULARITY_CAP, Math.floor(listenerCount / POPULARITY_BUCKET));

      const score =
        followSpeakerCount * FOLLOW_SPEAKER_WEIGHT + topicMatch * TOPIC_MATCH_WEIGHT + popularity;
      return { room, score, followSpeakerCount };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.room.createdAt.getTime() - a.room.createdAt.getTime();
    });

    return scored.slice(0, limit).map(({ room, followSpeakerCount }) => ({
      ...room,
      // Surface the reason-for-ranking so the UI can label "Friends inside".
      knownSpeakers: room.participants
        .filter(p => followedIds.has(p.userId) && p.role !== 'LISTENER')
        .slice(0, 3)
        .map(p => p.user),
      hasKnownSpeakers: followSpeakerCount > 0,
    }));
  },

  // ──────────────────────────── Hand-raise queue ──────────────────────────
  // The queue is FIFO (ordered by `raisedAt`). Hosts pop the head by
  // promoting the user via `setRole(SPEAKER)` which auto-clears the row.

  async raiseHand(roomId: string, userId: string) {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt || !room.isLive) throw new AppError('ROOM_004');
    await requireActiveParticipant(roomId, userId);

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
    await prisma.roomHandRaise.deleteMany({ where: { roomId, userId } });
    emitRoomHandLowered(roomId, userId);
    return { lowered: true as const };
  },

  async listHandRaises(roomId: string, viewerId: string) {
    await requireActiveParticipant(roomId, viewerId);
    const rows = await prisma.roomHandRaise.findMany({
      where: { roomId },
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
      if (!me || (me.role !== 'HOST' && me.role !== 'MODERATOR')) {
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
      select: { chatVisibility: true },
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
      if (!me || (me.role !== 'HOST' && me.role !== 'MODERATOR')) {
        return [];
      }
    }
    const rows = await prisma.roomChatMessage.findMany({
      where: { roomId, isDeleted: false },
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
    const room = await requireHostOrMod(roomId, callerUserId);
    if (room.hostId === targetUserId) throw new AppError('ROOM_003');
    // Can't kick yourself
    if (callerUserId === targetUserId) throw new AppError('USER_003');

    const res = await prisma.participant.updateMany({
      where: { roomId, userId: targetUserId, leftAt: null },
      data: { leftAt: new Date() },
    });
    if (res.count === 0) throw new AppError('ROOM_005');

    await prisma.$transaction([
      prisma.user.update({ where: { id: targetUserId }, data: { currentRoomId: null } }),
      prisma.room.update({ where: { id: roomId }, data: { participantCount: { decrement: 1 } } }),
    ]);
    // Also clear any hand-raise
    await prisma.roomHandRaise.deleteMany({ where: { roomId, userId: targetUserId } });

    // Install ban so they can't bounce right back. banMinutes=0 → permanent.
    // Default 30 min keeps the friction proportionate to the offense.
    const minutes = options.banMinutes ?? DEFAULT_KICK_BAN_MINUTES;
    const expiresAt = minutes === 0 ? null : new Date(Date.now() + minutes * MS_PER_MINUTE);
    await prisma.roomBan.upsert({
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

    emitRoomUserKicked(roomId, { userId: targetUserId, kickedBy: callerUserId });
    emitHallwayRoomUpdated(roomId, { participantCount: Math.max(0, room.participantCount - 1) });
    return { kicked: true as const };
  },

  // ──────────────────── Live room metadata ────────────────────────────
  async updateTitle(roomId: string, callerUserId: string, input: UpdateRoomTitleInput) {
    await requireHostOrMod(roomId, callerUserId);
    const updated = await prisma.room.update({
      where: { id: roomId },
      data: { title: input.title },
      select: { id: true, title: true, isPrivate: true },
    });
    emitRoomMetaUpdated(roomId, { title: updated.title });
    if (!updated.isPrivate) {
      emitHallwayRoomUpdated(roomId, { title: updated.title });
    }
    return { title: updated.title };
  },

  async toggleChat(roomId: string, callerUserId: string, input: ToggleRoomChatInput) {
    await requireHostOrMod(roomId, callerUserId);
    const data: { chatEnabled?: boolean; chatVisibility?: 'ALL' | 'MODS_ONLY' } = {};
    if (typeof input.chatEnabled === 'boolean') data.chatEnabled = input.chatEnabled;
    if (input.chatVisibility) {
      data.chatVisibility = input.chatVisibility === 'mods' ? 'MODS_ONLY' : 'ALL';
    }
    if (Object.keys(data).length === 0) {
      throw new AppError('VALIDATION_001');
    }
    const updated = await prisma.room.update({
      where: { id: roomId },
      data,
      select: { chatEnabled: true, chatVisibility: true },
    });
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
    const targets = await prisma.participant.findMany({
      where: { roomId, leftAt: null, isMuted: false, role: roleIn },
      select: { userId: true },
    });
    if (targets.length === 0) return { mutedCount: 0 };

    await prisma.participant.updateMany({
      where: { roomId, userId: { in: targets.map(t => t.userId) }, leftAt: null },
      data: { isMuted: true },
    });
    for (const t of targets) {
      emitRoomMuteChanged(roomId, { userId: t.userId, isMuted: true });
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
      select: { id: true, title: true, hostId: true, isPrivate: true, endedAt: true },
    });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) throw new AppError('ROOM_004');

    // Anyone in the room can invite to public rooms; closed rooms restrict
    // to host/mod (preserves the invite-only semantics).
    if (room.isPrivate) {
      await requireHostOrMod(roomId, callerUserId);
    } else {
      await requireActiveParticipant(roomId, callerUserId);
    }

    // Drop self-invites + dedup ids defensively.
    const targets = [...new Set(input.userIds.filter(id => id !== callerUserId))];
    if (targets.length === 0) return { invitedCount: 0 };

    // Verify users exist; silently prune unknown ids.
    const existing = await prisma.user.findMany({
      where: { id: { in: targets } },
      select: { id: true },
    });
    const validIds = existing.map(u => u.id);

    // Closed rooms: pre-seat invitees as LISTENER so the join guard accepts
    // them. Two bulk queries (createMany skipDuplicates + updateMany to
    // un-leave re-invites) instead of N upserts — avoids up to 50 DB
    // round-trips when inviting the full batch.
    if (room.isPrivate && validIds.length > 0) {
      await prisma.participant.createMany({
        data: validIds.map(userId => ({ roomId, userId, role: 'LISTENER' as const })),
        skipDuplicates: true,
      });
      await prisma.participant.updateMany({
        where: { roomId, userId: { in: validIds }, leftAt: { not: null } },
        data: { leftAt: null },
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
      select: { id: true, title: true, endedAt: true, isPrivate: true },
    });
    if (!room) throw new AppError('ROOM_001');
    if (room.endedAt) throw new AppError('ROOM_004');
    if (room.isPrivate) throw new AppError('ROOM_007');

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
