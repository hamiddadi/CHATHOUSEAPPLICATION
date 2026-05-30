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
 * De-duplication: a Redis Set per room captures already-notified rooms
 * (`ext:fanout:notified:<roomId>`) with a 24h TTL — so the worker is
 * idempotent across restarts.
 */

const SCAN_INTERVAL_MS = 30 * 1000;
const LOOKBACK_MS = 90 * 1000; // scan rooms created in the last 90s
const DEDUP_KEY = (roomId: string) => `ext:fanout:notified:${roomId}`;
const DEDUP_TTL_S = 24 * 3600;
const FANOUT_CONCURRENCY = 20; // notifications dispatched in parallel per chunk

let timer: NodeJS.Timeout | null = null;

export const fanoutOne = async (roomId: string): Promise<number> => {
  // Idempotency guard — atomic SET NX
  const claimed = await redis.set(DEDUP_KEY(roomId), '1', {
    NX: true,
    EX: DEDUP_TTL_S,
  });
  if (claimed !== 'OK') return 0;

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      host: { select: { id: true, displayName: true, username: true } },
    },
  });
  if (!room || !room.isLive || room.endedAt) return 0;
  // Don't fan out private rooms.
  if (room.isPrivate || room.roomType === 'CLOSED') return 0;

  // Pull followers of the host (cap to avoid runaway scans on viral hosts;
  // real-world fan-out would batch via a queue).
  const followers = await prisma.follow.findMany({
    where: { followingId: room.hostId },
    select: { followerId: true },
    take: 5000,
  });

  const title = room.host.displayName ?? room.host.username ?? 'Someone you follow';
  const body = `started a room: "${room.title}"`;

  // Bounded-concurrency fan-out. We keep notificationsService.create per
  // follower (it owns the WS emit, push dispatch and unread-badge bump that a
  // bare prisma.createMany would skip), but process FANOUT_CONCURRENCY at a
  // time instead of strictly serial — cutting wall-clock round-trips ~Nx for
  // viral hosts without a new dependency.
  // TODO(audit): a true durable fan-out should enqueue per-follower jobs (e.g.
  // BullMQ) rather than scan-and-batch in-process.
  let count = 0;
  for (let i = 0; i < followers.length; i += FANOUT_CONCURRENCY) {
    const chunk = followers.slice(i, i + FANOUT_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(f =>
        notificationsService.create({
          userId: f.followerId,
          actorId: room.hostId,
          type: 'ROOM_STARTED',
          title,
          body,
          data: { roomId: room.id, source: 'ext.fanout.follow' },
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
          userId: chunk[idx]?.followerId,
          roomId,
        });
      }
    });
  }
  return count;
};

const scanRecent = async (): Promise<void> => {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const rooms = await prisma.room.findMany({
    where: {
      createdAt: { gte: since },
      isLive: true,
      endedAt: null,
      isPrivate: false,
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
