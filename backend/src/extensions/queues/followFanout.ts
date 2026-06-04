import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { logger } from '../../config/logger';
import { notificationsService } from '../../modules/notifications/notifications.service';

/**
 * "Follow started a room" fan-out (Module 12.1 / NOTIF-001).
 *
 * The existing rooms.service emits `hallway:room_created` on the socket
 * tier but does NOT push a personal notification to every follower of the
 * host. Modifying it would violate the no-touch rule, so this extension
 * watches recently-created rooms via a periodic scan and fans out a
 * ROOM_STARTED notification to each follower of the host.
 *
 * De-duplication: a Redis key per room captures already-notified rooms
 * (`ext:fanout:notified:<roomId>`) with a 24h TTL — so the worker is
 * idempotent across restarts. The claim is RELEASED if the fan-out body
 * throws, so a transient failure (DB blip) doesn't permanently suppress the
 * notification — the next scan/create-trigger re-attempts.
 */

const SCAN_INTERVAL_MS = 30 * 1000;
const LOOKBACK_MS = 90 * 1000; // scan rooms created in the last 90s
const DEDUP_KEY = (roomId: string) => `ext:fanout:notified:${roomId}`;
const DEDUP_TTL_S = 24 * 3600;
const FANOUT_CONCURRENCY = 20; // notifications dispatched in parallel per chunk
const CLUB_MEMBER_CAP = 5000; // upper bound on club members fanned out per room

let timer: NodeJS.Timeout | null = null;

export const fanoutOne = async (roomId: string): Promise<number> => {
  // Idempotency guard — atomic SET NX. Released on error (see catch) so a
  // failure between claim and dispatch can be retried by a later pass.
  const claimed = await redis.set(DEDUP_KEY(roomId), '1', {
    NX: true,
    EX: DEDUP_TTL_S,
  });
  if (claimed !== 'OK') return 0;

  try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        host: { select: { id: true, displayName: true, username: true } },
      },
    });
    if (!room || !room.isLive || room.endedAt) return 0;
    // Don't fan out private rooms.
    if (room.isPrivate || room.roomType === 'CLOSED') return 0;

    // Pull followers of the host + (if clubbed) the club members concurrently —
    // the club query depends only on room.clubId, not on the followers result.
    // Both are capped to avoid runaway scans on viral hosts/clubs.
    const [followers, clubMembers] = await Promise.all([
      prisma.follow.findMany({
        where: { followingId: room.hostId },
        select: { followerId: true },
        take: 5000,
      }),
      room.clubId
        ? prisma.clubMember.findMany({
            where: { clubId: room.clubId },
            select: { userId: true },
            take: CLUB_MEMBER_CAP,
          })
        : Promise.resolve<{ userId: string }[]>([]),
    ]);

    const title = room.host.displayName ?? room.host.username ?? 'Someone you follow';
    const body = `started a room: "${room.title}"`;

    // Track every recipient we've already queued so a user who both follows the
    // host AND belongs to the room's club is only notified once. Seed it with the
    // host so they never get a "you started a room" ping about their own room.
    const notified = new Set<string>([room.hostId]);

    // Build the ordered recipient list: followers first, then any club members
    // (NOTIF: notify CLUB members on a direct live room). De-dupe via `notified`.
    const recipients: string[] = [];
    for (const f of followers) {
      if (!notified.has(f.followerId)) {
        notified.add(f.followerId);
        recipients.push(f.followerId);
      }
    }

    // Club members (already fetched above) also learn the room went live — even
    // when they don't follow the host. Reuse the same ROOM_STARTED type/data
    // shape; only the dispatch source tag differs. De-duped via `notified`.
    for (const m of clubMembers) {
      if (!notified.has(m.userId)) {
        notified.add(m.userId);
        recipients.push(m.userId);
      }
    }

    const followerIds = new Set(followers.map(f => f.followerId));
    const sourceFor = (userId: string): string =>
      followerIds.has(userId) ? 'ext.fanout.follow' : 'ext.fanout.club';

    // Bounded-concurrency fan-out. We keep notificationsService.create per
    // recipient (it owns the WS emit, push dispatch and unread-badge bump that a
    // bare prisma.createMany would skip), but process FANOUT_CONCURRENCY at a
    // time instead of strictly serial — cutting wall-clock round-trips ~Nx for
    // viral hosts without a new dependency.
    // TODO(audit): a true durable fan-out should enqueue per-recipient jobs (e.g.
    // BullMQ) rather than scan-and-batch in-process.
    let count = 0;
    for (let i = 0; i < recipients.length; i += FANOUT_CONCURRENCY) {
      const chunk = recipients.slice(i, i + FANOUT_CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(userId =>
          notificationsService.create({
            userId,
            actorId: room.hostId,
            type: 'ROOM_STARTED',
            title,
            body,
            data: { roomId: room.id, source: sourceFor(userId) },
            targetId: room.id,
            targetType: 'room',
          }),
        ),
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          count += 1;
        } else {
          logger.warn('ext.fanout: notify failed', {
            err: r.reason,
            userId: chunk[idx],
            roomId,
          });
        }
      });
    }
    return count;
  } catch (err) {
    // Release the idempotency claim so a transient failure (DB/Redis blip)
    // doesn't permanently suppress this room's fan-out for 24h.
    await redis.del(DEDUP_KEY(roomId)).catch(() => {});
    throw err;
  }
};

const scanRecent = async (): Promise<void> => {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const rooms = await prisma.room.findMany({
    where: {
      createdAt: { gte: since },
      isLive: true,
      endedAt: null,
      isPrivate: false,
      // roomType CLOSED rooms are never fanned out (fanoutOne re-checks too);
      // exclude them here so we don't waste an idempotency claim on them.
      roomType: { not: 'CLOSED' },
      // Exclude scheduled-but-not-yet-live (those are handled by the
      // existing 5-min reminder + our 15-min sister worker).
      scheduledFor: null,
    },
    select: { id: true },
    take: 200,
  });

  for (const r of rooms) {
    try {
      const n = await fanoutOne(r.id);
      if (n > 0) {
        logger.info('ext.fanout: room fanned out', { roomId: r.id, count: n });
      }
    } catch (err) {
      logger.error('ext.fanout: fanoutOne crashed', { err, roomId: r.id });
    }
  }
};

export const startFollowFanoutWorker = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    void scanRecent().catch(err => logger.warn('ext.fanout: scan failed', { err }));
  }, SCAN_INTERVAL_MS);
  timer.unref();
  logger.info('ext.fanout: follow→room fan-out worker started');
};

export const shutdownFollowFanout = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

// Exposed for tests
export const _internals = { fanoutOne, scanRecent };
