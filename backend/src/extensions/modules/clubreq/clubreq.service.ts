import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database';
import { logger } from '../../../config/logger';
import { redis } from '../../../config/redis';
import { AppError } from '../../../middlewares/error.middleware';
import { notificationsService } from '../../../modules/notifications/notifications.service';
import { clubDeletionTombstoneKey } from '../../club-extension-cleanup.outbox';

/**
 * Club join request workflow (Module 10.3 / CLUB-006..009 / NOTIF-008).
 *
 * Stored in Redis (no schema migration). Each request lives at
 * `ext:clubreq:<clubId>:<userId>` with the JSON payload, and an index set
 * at `ext:clubreq:club:<clubId>` lets admins list pending requests.
 *
 * Approve → moves the user into ClubMember (existing) and notifies them.
 * Decline → removes the request and notifies the user.
 */

interface JoinRequest {
  clubId: string;
  userId: string;
  message: string | null;
  createdAt: string;
  // Additive (optional) discriminator so existing consumers keep working:
  //  - 'joined'  : OPEN club, the caller was added directly as a member
  //  - 'pending' : SOCIAL club, an admin must approve the request
  status?: 'joined' | 'pending';
  // Requester identity, denormalised into the admin list() response so the
  // approval UI shows a name/avatar instead of a raw user id. Omitted by
  // request() (the requester already knows who they are). Looked up live from
  // Prisma at list() time, so existing Redis payloads need no backfill.
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

const reqKey = (clubId: string, userId: string) => `ext:clubreq:${clubId}:${userId}`;
const indexKey = (clubId: string) => `ext:clubreq:club:${clubId}`;
const TTL_S = 30 * 24 * 3600; // 30 days

const STORE_PENDING_REQUEST_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
local first = redis.call('SADD', KEYS[2], ARGV[1])
redis.call('SETEX', KEYS[3], tonumber(ARGV[2]), ARGV[3])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[2]))
return first
`;

const storePendingRequest = async (request: JoinRequest): Promise<boolean | null> => {
  const result = await redis.eval(STORE_PENDING_REQUEST_SCRIPT, {
    keys: [
      clubDeletionTombstoneKey(request.clubId),
      indexKey(request.clubId),
      reqKey(request.clubId, request.userId),
    ],
    arguments: [request.userId, String(TTL_S), JSON.stringify(request)],
  });
  const numeric = Number(result);
  if (numeric === -1) return null;
  return numeric === 1;
};

const isAdmin = async (clubId: string, userId: string): Promise<boolean> => {
  const club = await prisma.club.findFirst({
    where: {
      id: clubId,
      owner: {
        deletedAt: null,
        blocksCreated: { none: { blockedId: userId } },
        blocksReceived: { none: { blockerId: userId } },
      },
    },
    select: { ownerId: true },
  });
  if (!club) return false;
  if (club.ownerId === userId) return true;

  const m = await prisma.clubMember.findFirst({
    where: { clubId, userId, user: { deletedAt: null } },
    select: { role: true },
  });
  return m?.role === 'ADMIN' || m?.role === 'MODERATOR';
};

const consumePendingRequest = async (clubId: string, userId: string): Promise<JoinRequest> => {
  // GETDEL is the request capability claim. Exactly one concurrent
  // approve/decline call can consume it and therefore emit a result
  // notification.
  const raw = await redis.getDel(reqKey(clubId, userId));
  if (!raw) throw new AppError('CLUB_001', 'Request not found');
  await redis.sRem(indexKey(clubId), userId);

  try {
    const parsed = JSON.parse(raw) as Partial<JoinRequest>;
    if (parsed.clubId !== clubId || parsed.userId !== userId) {
      throw new Error('Invalid join-request payload');
    }
    return parsed as JoinRequest;
  } catch (err) {
    logger.warn('ext.clubreq: discarded corrupt request', { err, clubId, userId });
    throw new AppError('CLUB_001', 'Request not found');
  }
};

const restorePendingRequest = async (request: JoinRequest): Promise<void> => {
  await storePendingRequest(request);
};

export const clubReqService = {
  async request(callerId: string, clubId: string, message?: string): Promise<JoinRequest> {
    const club = await prisma.club.findFirst({
      where: {
        id: clubId,
        owner: {
          deletedAt: null,
          blocksCreated: { none: { blockedId: callerId } },
          blocksReceived: { none: { blockerId: callerId } },
        },
      },
      select: { id: true, name: true, privacy: true, ownerId: true },
    });
    if (!club) throw new AppError('CLUB_001');
    const existingMember = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: callerId } },
      select: { id: true },
    });
    if (existingMember) throw new AppError('CLUB_002', 'Already a member');

    // PRIVATE clubs stay invitation-only — mirror core clubsService.join()'s
    // CLUB_003 guard so a join request can never be queued for them (the only
    // way in is an admin's CLUB_INVITE → /clubs/:id/accept). SOCIAL is the
    // sole "request + approval" privacy tier.
    if (club.privacy === 'PRIVATE') throw new AppError('CLUB_003');

    const payload: JoinRequest = {
      clubId,
      userId: callerId,
      message: message ?? null,
      createdAt: new Date().toISOString(),
    };

    // OPEN clubs have no gatekeeping: join directly as a member instead of
    // queuing an approval request (and spamming admins with notifications).
    if (club.privacy === 'OPEN') {
      try {
        await prisma.$transaction(async tx => {
          const eligible = await tx.club.updateMany({
            where: {
              id: clubId,
              privacy: 'OPEN',
              owner: {
                deletedAt: null,
                blocksCreated: { none: { blockedId: callerId } },
                blocksReceived: { none: { blockerId: callerId } },
              },
            },
            data: { memberCount: { increment: 1 } },
          });
          if (eligible.count !== 1) {
            throw new AppError('CLUB_003', 'Club is no longer open');
          }
          await tx.clubMember.create({
            data: { clubId, userId: callerId, role: 'MEMBER' },
          });
        });
      } catch (err) {
        // Lost a race with another direct-join — already a member, fine.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
          throw err;
        }
      }
      return { ...payload, status: 'joined' };
    }

    // SOCIAL: queue (or refresh) a pending approval request. Only
    // notify admins on the FIRST submission so a user can't spam admins by
    // re-POSTing the same request (idempotent re-submission).
    // One Lua operation checks the deletion tombstone, writes the request and
    // updates the bounded-lifetime index. It also returns first-submission
    // status, so concurrent double-submits cannot both notify administrators.
    const isFirstRequest = await storePendingRequest(payload);
    if (isFirstRequest === null) throw new AppError('CLUB_001', 'Club no longer exists');
    if (!isFirstRequest) {
      return { ...payload, status: 'pending' };
    }

    // Notify all admins/moderators of the club.
    const admins = await prisma.clubMember.findMany({
      where: {
        clubId,
        role: { in: ['ADMIN', 'MODERATOR'] },
        user: {
          deletedAt: null,
          blocksCreated: { none: { blockedId: callerId } },
          blocksReceived: { none: { blockerId: callerId } },
        },
      },
      select: { userId: true },
    });
    const recipients = Array.from(new Set([club.ownerId, ...admins.map(a => a.userId)]));
    for (const u of recipients) {
      try {
        await notificationsService.create({
          userId: u,
          actorId: callerId,
          type: 'CLUB_INVITE',
          title: `${club.name} • join request`,
          body: message ?? 'A user wants to join this club',
          data: { kind: 'join_request', clubId, requesterId: callerId },
          targetId: clubId,
          targetType: 'club',
          dedupeKey: `club-join-request:${clubId}:${callerId}:${u}`,
        });
      } catch (err) {
        logger.warn('ext.clubreq: notify admin failed', { err, u });
      }
    }
    return { ...payload, status: 'pending' };
  },

  async list(
    callerId: string,
    clubId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<JoinRequest[]> {
    if (!(await isAdmin(clubId, callerId))) throw new AppError('AUTH_008');
    const allUserIds = await redis.sMembers(indexKey(clubId));
    if (allUserIds.length === 0) return [];

    // Bound the response: sMembers returns an unbounded set on a popular
    // club. Default page size 50, offset paging on the (sorted) id list.
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    // Stable order so offset paging is deterministic across calls.
    const userIds = [...allUserIds].sort().slice(offset, offset + limit);
    if (userIds.length === 0) return [];

    // Single MGET instead of one round-trip per member.
    const raws = await redis.mGet(userIds.map(uid => reqKey(clubId, uid)));
    const stale: string[] = [];
    const items: JoinRequest[] = [];
    userIds.forEach((uid, i) => {
      const raw = raws[i];
      if (!raw) {
        stale.push(uid);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as JoinRequest;
        if (parsed.clubId !== clubId || parsed.userId !== uid) {
          stale.push(uid);
          return;
        }
        items.push(parsed);
      } catch {
        stale.push(uid);
      }
    });
    // Lazily prune index entries whose request key expired / is corrupt.
    if (stale.length > 0) {
      await redis.sRem(indexKey(clubId), stale);
    }
    if (items.length === 0) return items;

    // Denormalise requester identity so admins see names, not raw cuids. One
    // batched query for the whole page. A requester whose account was hard-
    // deleted keeps the bare userId (the row is harmless and rare).
    const requesters = await prisma.user.findMany({
      where: { id: { in: items.map(it => it.userId) }, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        blocksCreated: {
          where: { blockedId: callerId },
          select: { id: true },
          take: 1,
        },
        blocksReceived: {
          where: { blockerId: callerId },
          select: { id: true },
          take: 1,
        },
      },
    });
    const byId = new Map(requesters.map(u => [u.id, u]));
    return items.flatMap(it => {
      const u = byId.get(it.userId);
      if (!u || u.blocksCreated.length > 0 || u.blocksReceived.length > 0) return [];
      return [
        {
          ...it,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
        },
      ];
    });
  },

  async approve(callerId: string, clubId: string, requesterId: string) {
    if (!(await isAdmin(clubId, callerId))) throw new AppError('AUTH_008');
    const pending = await consumePendingRequest(clubId, requesterId);

    // Idempotent add — only the unique-constraint violation (already a
    // member) is swallowed. Any other failure must propagate so we don't
    // notify "approved" while leaving the user a non-member. The create +
    // memberCount increment run in one transaction so the denormalized
    // counter can never diverge from the membership row.
    let clubName = 'the club';
    try {
      clubName = await prisma.$transaction(async tx => {
        const club = await tx.club.findFirst({
          where: {
            id: clubId,
            privacy: 'SOCIAL',
            owner: {
              deletedAt: null,
              blocksCreated: { none: { blockedId: requesterId } },
              blocksReceived: { none: { blockerId: requesterId } },
            },
          },
          select: { name: true },
        });
        const requester = await tx.user.findFirst({
          where: { id: requesterId, deletedAt: null },
          select: { id: true },
        });
        if (!club || !requester) {
          throw new AppError('CLUB_001', 'Request is no longer valid');
        }

        const existing = await tx.clubMember.findUnique({
          where: { clubId_userId: { clubId, userId: requesterId } },
          select: { id: true },
        });
        if (existing) return club.name;

        const eligible = await tx.club.updateMany({
          where: {
            id: clubId,
            privacy: 'SOCIAL',
            owner: {
              deletedAt: null,
              blocksCreated: { none: { blockedId: requesterId } },
              blocksReceived: { none: { blockerId: requesterId } },
            },
          },
          data: { memberCount: { increment: 1 } },
        });
        if (eligible.count !== 1) {
          throw new AppError('CLUB_001', 'Request is no longer valid');
        }
        await tx.clubMember.create({
          data: { clubId, userId: requesterId, role: 'MEMBER' },
        });
        return club.name;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Already a member — the transaction rolled back, so memberCount was
        // not incremented. Treat as idempotent success.
        logger.warn('ext.clubreq: approve target already a member', {
          clubId,
          requesterId,
        });
        clubName =
          (
            await prisma.club.findUnique({
              where: { id: clubId },
              select: { name: true },
            })
          )?.name ?? clubName;
      } else if (err instanceof AppError) {
        throw err;
      } else {
        await restorePendingRequest(pending);
        throw err;
      }
    }
    try {
      await notificationsService.create({
        userId: requesterId,
        actorId: callerId,
        type: 'CLUB_INVITE',
        title: `Welcome to ${clubName}`,
        body: 'Your join request was approved',
        data: { kind: 'join_approved', clubId },
        targetId: clubId,
        targetType: 'club',
        dedupeKey: `club-join-approved:${clubId}:${requesterId}`,
      });
    } catch (err) {
      logger.warn('ext.clubreq: approval notification failed', { err, clubId, requesterId });
    }
    return { approved: true };
  },

  async decline(callerId: string, clubId: string, requesterId: string) {
    if (!(await isAdmin(clubId, callerId))) throw new AppError('AUTH_008');
    // Symmetric with approve(): reject if there's no pending request, so a
    // declining admin can't fire a spurious "declined" notification.
    await consumePendingRequest(clubId, requesterId);
    const [club, requester] = await Promise.all([
      prisma.club.findUnique({ where: { id: clubId }, select: { name: true } }),
      prisma.user.findFirst({
        where: { id: requesterId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (requester) {
      try {
        await notificationsService.create({
          userId: requesterId,
          actorId: callerId,
          type: 'CLUB_INVITE',
          title: club?.name ?? 'Club',
          body: 'Your join request was declined',
          data: { kind: 'join_declined', clubId },
          targetId: clubId,
          targetType: 'club',
          dedupeKey: `club-join-declined:${clubId}:${requesterId}`,
        });
      } catch (err) {
        logger.warn('ext.clubreq: decline notification failed', { err, clubId, requesterId });
      }
    }
    return { declined: true };
  },
};
