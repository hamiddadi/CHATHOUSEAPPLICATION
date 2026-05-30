import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database';
import { redis } from '../../../config/redis';
import { AppError } from '../../../middlewares/error.middleware';
import { notificationsService } from '../../../modules/notifications/notifications.service';
import { logger } from '../../../config/logger';

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
  //  - 'pending' : SOCIAL/PRIVATE club, an admin must approve the request
  status?: 'joined' | 'pending';
}

const reqKey = (clubId: string, userId: string) => `ext:clubreq:${clubId}:${userId}`;
const indexKey = (clubId: string) => `ext:clubreq:club:${clubId}`;
const TTL_S = 30 * 24 * 3600; // 30 days

const isAdmin = async (clubId: string, userId: string): Promise<boolean> => {
  const m = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: { role: true },
  });
  return m?.role === 'ADMIN' || m?.role === 'MODERATOR';
};

export const clubReqService = {
  async request(callerId: string, clubId: string, message?: string): Promise<JoinRequest> {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, name: true, privacy: true, ownerId: true },
    });
    if (!club) throw new AppError('CLUB_001');
    const existingMember = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: callerId } },
      select: { id: true },
    });
    if (existingMember) throw new AppError('CLUB_002', 'Already a member');

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
        await prisma.$transaction([
          prisma.clubMember.create({
            data: { clubId, userId: callerId, role: 'MEMBER' },
          }),
          prisma.club.update({
            where: { id: clubId },
            data: { memberCount: { increment: 1 } },
          }),
        ]);
      } catch (err) {
        // Lost a race with another direct-join — already a member, fine.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
          throw err;
        }
      }
      return { ...payload, status: 'joined' };
    }

    // SOCIAL/PRIVATE: queue (or refresh) a pending approval request. Only
    // notify admins on the FIRST submission so a user can't spam admins by
    // re-POSTing the same request (idempotent re-submission).
    const alreadyPending = await redis.exists(reqKey(clubId, callerId));
    await Promise.all([
      redis.setEx(reqKey(clubId, callerId), TTL_S, JSON.stringify(payload)),
      redis.sAdd(indexKey(clubId), callerId),
    ]);
    if (alreadyPending) {
      return { ...payload, status: 'pending' };
    }

    // Notify all admins/moderators of the club.
    const admins = await prisma.clubMember.findMany({
      where: { clubId, role: { in: ['ADMIN', 'MODERATOR'] } },
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
        items.push(JSON.parse(raw) as JoinRequest);
      } catch {
        stale.push(uid);
      }
    });
    // Lazily prune index entries whose request key expired / is corrupt.
    if (stale.length > 0) {
      await redis.sRem(indexKey(clubId), stale);
    }
    return items;
  },

  async approve(callerId: string, clubId: string, requesterId: string) {
    if (!(await isAdmin(clubId, callerId))) throw new AppError('AUTH_008');
    const raw = await redis.get(reqKey(clubId, requesterId));
    if (!raw) throw new AppError('CLUB_001', 'Request not found');

    // Idempotent add — only the unique-constraint violation (already a
    // member) is swallowed. Any other failure must propagate so we don't
    // notify "approved" while leaving the user a non-member. The create +
    // memberCount increment run in one transaction so the denormalized
    // counter can never diverge from the membership row.
    try {
      await prisma.$transaction([
        prisma.clubMember.create({
          data: { clubId, userId: requesterId, role: 'MEMBER' },
        }),
        prisma.club.update({
          where: { id: clubId },
          data: { memberCount: { increment: 1 } },
        }),
      ]);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Already a member — the transaction rolled back, so memberCount was
        // not incremented. Treat as idempotent success.
        logger.warn('ext.clubreq: approve target already a member', {
          clubId,
          requesterId,
        });
      } else {
        throw err;
      }
    }
    await Promise.all([
      redis.del(reqKey(clubId, requesterId)),
      redis.sRem(indexKey(clubId), requesterId),
    ]);
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { name: true },
    });
    await notificationsService.create({
      userId: requesterId,
      actorId: callerId,
      type: 'CLUB_INVITE',
      title: `Welcome to ${club?.name ?? 'the club'}`,
      body: 'Your join request was approved',
      data: { kind: 'join_approved', clubId },
      targetId: clubId,
      targetType: 'club',
    });
    return { approved: true };
  },

  async decline(callerId: string, clubId: string, requesterId: string) {
    if (!(await isAdmin(clubId, callerId))) throw new AppError('AUTH_008');
    await Promise.all([
      redis.del(reqKey(clubId, requesterId)),
      redis.sRem(indexKey(clubId), requesterId),
    ]);
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { name: true },
    });
    await notificationsService.create({
      userId: requesterId,
      actorId: callerId,
      type: 'CLUB_INVITE',
      title: club?.name ?? 'Club',
      body: 'Your join request was declined',
      data: { kind: 'join_declined', clubId },
      targetId: clubId,
      targetType: 'club',
    });
    return { declined: true };
  },
};
