import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { logger } from '../../config/logger';
import { notificationsService } from '../../modules/notifications/notifications.service';
import { getBlockedIdSet } from '../../modules/social/blocks';

/**
 * "Follow started a room" fan-out (Module 12.1 / NOTIF-001).
 *
 * Recipient progress is tracked independently. A successful recipient never
 * has to be recreated on a retry, while a failed/busy recipient keeps the
 * overall call retryable. The short processing claim prevents concurrent
 * workers from creating the same row; the SQL lookup repairs the crash window
 * between Notification insertion and the durable Redis completion marker.
 */

const SCAN_INTERVAL_MS = 30 * 1000;
const LOOKBACK_MS = 90 * 1000;
const RECIPIENT_DONE_KEY = (roomId: string) => `ext:fanout:v2:notified:${roomId}`;
const RECIPIENT_CLAIM_KEY = (roomId: string, userId: string) =>
  `ext:fanout:v2:claim:${roomId}:${userId}`;
const DEDUP_TTL_S = 24 * 3600;
const CLAIM_TTL_S = 5 * 60;
const PAGE_SIZE = 250;
const FANOUT_CONCURRENCY = 20;

const RELEASE_CLAIM_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

let timer: NodeJS.Timeout | null = null;

interface FanoutRoom {
  id: string;
  hostId: string;
  clubId: string | null;
  title: string;
  roomType: string;
  host: {
    displayName: string | null;
    username: string | null;
  };
}

interface FollowerPageRow {
  id: string;
  followerId: string;
  createdAt: Date;
}

interface ClubMemberPageRow {
  userId: string;
}

type RecipientSource = 'ext.fanout.follow' | 'ext.fanout.club';
type RecipientResult = 'created' | 'already-created' | 'busy';

const markRecipientDone = async (roomId: string, userId: string): Promise<void> => {
  await redis
    .multi()
    .sAdd(RECIPIENT_DONE_KEY(roomId), userId)
    .expire(RECIPIENT_DONE_KEY(roomId), DEDUP_TTL_S)
    .exec();
};

const releaseRecipientClaim = async (
  roomId: string,
  userId: string,
  token: string,
): Promise<void> => {
  try {
    await redis.eval(RELEASE_CLAIM_SCRIPT, {
      keys: [RECIPIENT_CLAIM_KEY(roomId, userId)],
      arguments: [token],
    });
  } catch (err) {
    // The claim expires by itself. Do not replace the original delivery error
    // with a cleanup failure, and never blindly DEL another worker's claim.
    logger.warn('ext.fanout: recipient claim release failed', { err, roomId, userId });
  }
};

const notifyRecipient = async (
  room: FanoutRoom,
  userId: string,
  source: RecipientSource,
  title: string,
  body: string,
): Promise<RecipientResult> => {
  const doneKey = RECIPIENT_DONE_KEY(room.id);
  if (await redis.sIsMember(doneKey, userId)) return 'already-created';

  const claimKey = RECIPIENT_CLAIM_KEY(room.id, userId);
  const claimToken = randomUUID();
  const claimed = await redis.set(claimKey, claimToken, { NX: true, EX: CLAIM_TTL_S });
  if (claimed !== 'OK') {
    // The owner may have completed between our first membership read and the
    // failed claim. Otherwise report "busy" so callers retry after its TTL.
    return (await redis.sIsMember(doneKey, userId)) ? 'already-created' : 'busy';
  }

  try {
    // If the process died after the SQL insert but before SADD, a retry repairs
    // only the Redis marker. actor/target make this specific to the live-room
    // fan-out and do not collide with the earlier RSVP reminder row.
    const existing = await prisma.notification.findFirst({
      where: {
        userId,
        actorId: room.hostId,
        type: 'ROOM_STARTED',
        targetId: room.id,
        targetType: 'room',
      },
      select: { id: true },
    });
    if (existing) {
      await markRecipientDone(room.id, userId);
      return 'already-created';
    }

    await notificationsService.create({
      userId,
      actorId: room.hostId,
      type: 'ROOM_STARTED',
      title,
      body,
      data: { roomId: room.id, source },
      targetId: room.id,
      targetType: 'room',
    });
    await markRecipientDone(room.id, userId);
    return 'created';
  } finally {
    await releaseRecipientClaim(room.id, userId, claimToken);
  }
};

interface DispatchState {
  created: number;
  incomplete: Set<string>;
}

const dispatchPage = async (
  room: FanoutRoom,
  recipientIds: string[],
  source: RecipientSource,
  title: string,
  body: string,
  excluded: ReadonlySet<string>,
  state: DispatchState,
): Promise<void> => {
  const eligibleIds = recipientIds.filter(userId => !excluded.has(userId));
  for (let offset = 0; offset < eligibleIds.length; offset += FANOUT_CONCURRENCY) {
    const chunk = eligibleIds.slice(offset, offset + FANOUT_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(userId => notifyRecipient(room, userId, source, title, body)),
    );

    results.forEach((result, index) => {
      const userId = chunk[index];
      if (!userId) return;
      if (result.status === 'rejected') {
        state.incomplete.add(userId);
        logger.warn('ext.fanout: notify failed', { err: result.reason, userId, roomId: room.id });
        return;
      }
      if (result.value === 'busy') {
        state.incomplete.add(userId);
        return;
      }

      // A club page can repair a failed follower attempt for a member who is in
      // both audiences. Only recipients still incomplete after every source
      // make the fan-out call fail and request another retry.
      state.incomplete.delete(userId);
      if (result.value === 'created') state.created += 1;
    });
  }
};

const fanoutFollowers = async (
  room: FanoutRoom,
  title: string,
  body: string,
  excluded: ReadonlySet<string>,
  state: DispatchState,
): Promise<void> => {
  let cursor: { createdAt: Date; id: string } | null = null;
  while (true) {
    const page: FollowerPageRow[] = await prisma.follow.findMany({
      where: {
        followingId: room.hostId,
        status: 'ACCEPTED',
        follower: { deletedAt: null },
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      select: { id: true, followerId: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PAGE_SIZE,
    });
    await dispatchPage(
      room,
      page.map(follow => follow.followerId),
      'ext.fanout.follow',
      title,
      body,
      excluded,
      state,
    );
    if (page.length < PAGE_SIZE) return;
    const last: FollowerPageRow | undefined = page[page.length - 1];
    if (!last) return;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
};

const fanoutClubMembers = async (
  room: FanoutRoom,
  title: string,
  body: string,
  excluded: ReadonlySet<string>,
  state: DispatchState,
): Promise<void> => {
  if (!room.clubId || room.roomType !== 'OPEN') return;

  let cursorUserId: string | null = null;
  while (true) {
    const page: ClubMemberPageRow[] = await prisma.clubMember.findMany({
      where: {
        clubId: room.clubId,
        user: { deletedAt: null },
        ...(cursorUserId ? { userId: { gt: cursorUserId } } : {}),
      },
      select: { userId: true },
      orderBy: { userId: 'asc' },
      take: PAGE_SIZE,
    });
    await dispatchPage(
      room,
      page.map(member => member.userId),
      'ext.fanout.club',
      title,
      body,
      excluded,
      state,
    );
    if (page.length < PAGE_SIZE) return;
    cursorUserId = page[page.length - 1]?.userId ?? null;
    if (!cursorUserId) return;
  }
};

export const fanoutOne = async (roomId: string): Promise<number> => {
  const room = await prisma.room.findFirst({
    where: { id: roomId, host: { deletedAt: null } },
    include: {
      host: { select: { id: true, displayName: true, username: true } },
    },
  });
  if (!room || !room.isLive || room.endedAt) return 0;
  if (room.isPrivate || room.roomType === 'CLOSED') return 0;

  const blocked = await getBlockedIdSet(room.hostId);
  const excluded = new Set<string>([room.hostId, ...blocked]);
  const title = room.host.displayName ?? room.host.username ?? 'Someone you follow';
  const body = `started a room: "${room.title}"`;
  const state: DispatchState = { created: 0, incomplete: new Set<string>() };

  // Followers retain source priority when someone belongs to both audiences.
  // Each page is released before the next one is loaded, bounding DB results,
  // in-memory recipient arrays and notification concurrency independently of
  // audience size.
  await fanoutFollowers(room, title, body, excluded, state);
  await fanoutClubMembers(room, title, body, excluded, state);

  if (state.incomplete.size > 0) {
    throw new Error(
      `ROOM_STARTED fan-out incomplete for ${state.incomplete.size} recipient(s) in room ${roomId}`,
    );
  }
  return state.created;
};

const scanRecent = async (): Promise<void> => {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const rooms = await prisma.room.findMany({
    where: {
      createdAt: { gte: since },
      isLive: true,
      endedAt: null,
      isPrivate: false,
      roomType: { not: 'CLOSED' },
      host: { deletedAt: null },
      scheduledFor: null,
    },
    select: { id: true },
    take: 200,
  });

  for (const room of rooms) {
    try {
      const count = await fanoutOne(room.id);
      if (count > 0) {
        logger.info('ext.fanout: room fanned out', { roomId: room.id, count });
      }
    } catch (err) {
      logger.error('ext.fanout: fanoutOne crashed', { err, roomId: room.id });
    }
  }
};

export const startFollowFanoutWorker = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    void scanRecent().catch(err => logger.warn('ext.fanout: scan failed', { err }));
  }, SCAN_INTERVAL_MS);
  timer.unref();
  logger.info('ext.fanout: follow-to-room fan-out worker started');
};

export const shutdownFollowFanout = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

export const _internals = {
  fanoutOne,
  scanRecent,
  PAGE_SIZE,
  FANOUT_CONCURRENCY,
};
