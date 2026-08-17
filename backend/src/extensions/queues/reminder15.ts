import { createHash } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '../../config/logger';
import { prisma } from '../../config/database';
import {
  notificationDeliveryOutboxData,
  wakeNotificationDelivery,
} from '../../modules/notifications/notification.outbox';
import { getBlockedIdSet } from '../../modules/social/blocks';
import { bullConnection } from '../../queues/connection';

/**
 * 15-minute event reminder worker — sister to the existing 5-min worker
 * in `src/queues/eventReminders.ts`. The original is left untouched; this
 * one runs in parallel so subscribers get *two* reminders (15 min + 5 min)
 * matching the Clubhouse spec (Module 11.5 / NOTIF-006).
 *
 * Scheduling hook: extension code calls `scheduleReminder15(roomId, when)`
 * when a scheduled room is created. The existing rooms.service does NOT
 * call this — instead, a separate cron-scan compensates: every minute we
 * look for rooms scheduled in the next 16-minute window that don't have
 * a 15-min reminder jobId yet, and enqueue one.
 */

const QUEUE_NAME = 'ext-event-reminders-15';
const LEAD_TIME_MS = 15 * 60 * 1000;
const SCAN_INTERVAL_MS = 60 * 1000;
const SCAN_PAGE_SIZE = 250;
const RECIPIENT_PAGE_SIZE = 250;
const REMINDER_ATTEMPTS = 5;

export interface Reminder15JobData {
  roomId: string;
}

let queue: Queue<Reminder15JobData> | null = null;
let worker: Worker<Reminder15JobData> | null = null;
let scanTimer: NodeJS.Timeout | null = null;

export const getReminder15Queue = (): Queue<Reminder15JobData> => {
  if (!queue) {
    queue = new Queue<Reminder15JobData>(QUEUE_NAME, { connection: bullConnection() });
  }
  return queue;
};

const jobIdForRoom = (roomId: string) => `ext-room-reminder15-${roomId}`;

export const scheduleReminder15 = async (roomId: string, scheduledFor: Date): Promise<void> => {
  const delay = scheduledFor.getTime() - Date.now() - LEAD_TIME_MS;
  if (delay <= 0) return;
  const q = getReminder15Queue();
  await q.add(
    'remind15',
    { roomId },
    {
      jobId: jobIdForRoom(roomId),
      delay,
      // Retain the completed job through the compensating scan window. A
      // repeated scan then sees the same jobId instead of re-enqueueing it.
      removeOnComplete: { age: 2 * 3600 },
      removeOnFail: { age: 24 * 3600 },
      attempts: REMINDER_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5_000 },
    },
  );
};

export const cancelReminder15 = async (roomId: string): Promise<void> => {
  const q = getReminder15Queue();
  const job = await q.getJob(jobIdForRoom(roomId));
  if (job) await job.remove();
};

const reminderNotificationId = (roomId: string, userId: string): string =>
  `r15_${createHash('sha256').update(`${roomId}\0${userId}\0lead:15`).digest('hex')}`;

interface ReminderRoom {
  id: string;
  title: string;
  hostId: string;
  clubId: string | null;
}

/**
 * Persist one recipient page and its delivery hand-offs atomically. The stable
 * notification id also makes a BullMQ retry safe without adding a schema
 * column. Existing outbox keys are checked first so a user-deleted reminder is
 * not resurrected by a late retry.
 */
const persistRecipientPage = async (
  room: ReminderRoom,
  candidates: string[],
  blocked: Set<string>,
): Promise<number> => {
  const userIds = [...new Set(candidates)].filter(userId => !blocked.has(userId));
  if (userIds.length === 0) return 0;

  return prisma.$transaction(async tx => {
    const deliveries = userIds.map(userId => {
      const notificationId = reminderNotificationId(room.id, userId);
      return {
        userId,
        notificationId,
        outbox: notificationDeliveryOutboxData(notificationId, room.id),
      };
    });
    const existing = await tx.outboxEvent.findMany({
      where: { eventKey: { in: deliveries.map(item => item.outbox.eventKey) } },
      select: { eventKey: true },
    });
    const existingKeys = new Set(existing.map(item => item.eventKey));
    const fresh = deliveries.filter(item => !existingKeys.has(item.outbox.eventKey));
    if (fresh.length === 0) return 0;

    const created = await tx.notification.createMany({
      data: fresh.map(item => ({
        id: item.notificationId,
        userId: item.userId,
        actorId: room.hostId,
        type: 'RSVP_REMINDER',
        title: 'Starting soon',
        body: `"${room.title}" starts in 15 minutes`,
        data: { roomId: room.id, leadMinutes: 15 },
        targetId: room.id,
        targetType: 'room',
      })),
      skipDuplicates: true,
    });
    await tx.outboxEvent.createMany({
      data: fresh.map(item => item.outbox),
      skipDuplicates: true,
    });
    return created.count;
  });
};

const pageRecipients = async (
  load: (after: string | undefined) => Promise<Array<{ userId: string }>>,
  visit: (userIds: string[]) => Promise<number>,
): Promise<number> => {
  let after: string | undefined;
  let created = 0;
  do {
    const rows = await load(after);
    if (rows.length === 0) break;
    created += await visit(rows.map(row => row.userId));
    after = rows.at(-1)?.userId;
    if (rows.length < RECIPIENT_PAGE_SIZE) break;
  } while (after);
  return created;
};

export const processReminder15 = async (job: Job<Reminder15JobData>): Promise<void> => {
  const room = await prisma.room.findFirst({
    where: { id: job.data.roomId, host: { deletedAt: null } },
    select: {
      id: true,
      title: true,
      hostId: true,
      clubId: true,
      endedAt: true,
      canceledAt: true,
      scheduledFor: true,
    },
  });
  if (!room) return;
  if (room.endedAt) return; // canceled or ended

  // BullMQ can deliver a retained/delayed job after the event was rescheduled.
  // Never emit an obsolete reminder outside a narrow delivery tolerance.
  if (room.canceledAt || !room.scheduledFor) return;
  const untilStart = room.scheduledFor.getTime() - Date.now();
  if (untilStart < 0 || untilStart > LEAD_TIME_MS + 2 * SCAN_INTERVAL_MS) return;

  // EVEN-06: align the T-15 audience with the T-5 reminder
  // (`eventReminders.ts`): opted-in RSVPs + the host + (for club rooms) every
  // active club member. The two reminders previously diverged — T-15 reached
  // RSVPs only — so subscribers who relied on the club fan-out missed it.
  const blocked = await getBlockedIdSet(room.hostId);
  const persist = (userIds: string[]) => persistRecipientPage(room, userIds, blocked);
  let created = await persist([room.hostId]);

  created += await pageRecipients(
    after =>
      prisma.roomRsvp.findMany({
        where: {
          roomId: room.id,
          reminder: true,
          user: { deletedAt: null },
          ...(after ? { userId: { gt: after } } : {}),
        },
        select: { userId: true },
        orderBy: { userId: 'asc' },
        take: RECIPIENT_PAGE_SIZE,
      }),
    persist,
  );

  if (room.clubId) {
    const clubId = room.clubId;
    created += await pageRecipients(
      after =>
        prisma.clubMember.findMany({
          where: {
            clubId,
            user: { deletedAt: null },
            ...(after ? { userId: { gt: after } } : {}),
          },
          select: { userId: true },
          orderBy: { userId: 'asc' },
          take: RECIPIENT_PAGE_SIZE,
        }),
      persist,
    );
  }

  // Process one batch immediately; the process-scoped outbox poller drains
  // any remaining pages. A wake failure is retryable with the BullMQ job and
  // cannot duplicate rows because notification/outbox ids are deterministic.
  await wakeNotificationDelivery(room.id);
  logger.info('ext.reminder15: durable fanout queued', { roomId: room.id, created });
};

/**
 * Periodic compensating scan — picks up rooms scheduled within the next
 * ~16 minutes that don't yet have a 15-min reminder enqueued. Idempotent
 * via jobId.
 */
const scanForUpcoming = async (): Promise<void> => {
  const now = Date.now();
  const windowStart = new Date(now + LEAD_TIME_MS - SCAN_INTERVAL_MS);
  const windowEnd = new Date(now + LEAD_TIME_MS + SCAN_INTERVAL_MS);

  let after: string | undefined;
  do {
    const rooms = await prisma.room.findMany({
      where: {
        scheduledFor: { gte: windowStart, lte: windowEnd },
        endedAt: null,
        host: { deletedAt: null },
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true, scheduledFor: true },
      orderBy: { id: 'asc' },
      take: SCAN_PAGE_SIZE,
    });

    for (const room of rooms) {
      if (!room.scheduledFor) continue;
      await scheduleReminder15(room.id, room.scheduledFor);
    }
    after = rooms.at(-1)?.id;
    if (rooms.length < SCAN_PAGE_SIZE) break;
  } while (after);
};

export const startReminder15Worker = (): void => {
  if (worker) return;
  worker = new Worker<Reminder15JobData>(QUEUE_NAME, processReminder15, {
    connection: bullConnection(),
    concurrency: 2,
  });
  worker.on('failed', (job, err) => {
    logger.error('ext.reminder15: job failed', { jobId: job?.id, err: err.message });
  });
  scanTimer = setInterval(() => {
    void scanForUpcoming().catch(err => logger.warn('ext.reminder15: scan failed', { err }));
  }, SCAN_INTERVAL_MS);
  scanTimer.unref();
  logger.info('ext.reminder15: worker started (15-min lead)');
};

export const shutdownReminder15 = async (): Promise<void> => {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
};
