import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '../../config/logger';
import { prisma } from '../../config/database';
import { notificationsService } from '../../modules/notifications/notifications.service';
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

export interface Reminder15JobData {
  roomId: string;
}

let queue: Queue<Reminder15JobData> | null = null;
let worker: Worker<Reminder15JobData> | null = null;
let scanTimer: NodeJS.Timeout | null = null;

const getQueue = (): Queue<Reminder15JobData> => {
  if (!queue) {
    queue = new Queue<Reminder15JobData>(QUEUE_NAME, { connection: bullConnection() });
  }
  return queue;
};

const jobIdForRoom = (roomId: string) => `ext-room-reminder15-${roomId}`;

export const scheduleReminder15 = async (roomId: string, scheduledFor: Date): Promise<void> => {
  const delay = scheduledFor.getTime() - Date.now() - LEAD_TIME_MS;
  if (delay <= 0) return;
  const q = getQueue();
  await q.add(
    'remind15',
    { roomId },
    {
      jobId: jobIdForRoom(roomId),
      delay,
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    },
  );
};

export const cancelReminder15 = async (roomId: string): Promise<void> => {
  const q = getQueue();
  const job = await q.getJob(jobIdForRoom(roomId));
  if (job) await job.remove();
};

const processReminder15 = async (job: Job<Reminder15JobData>): Promise<void> => {
  const room = await prisma.room.findUnique({
    where: { id: job.data.roomId },
    include: { rsvps: { select: { userId: true } } },
  });
  if (!room) return;
  if (room.endedAt) return; // canceled or ended

  const recipients = Array.from(new Set(room.rsvps.map(r => r.userId)));
  const title = 'Starting soon';
  const body = `"${room.title}" starts in 15 minutes`;

  for (const userId of recipients) {
    try {
      await notificationsService.create({
        userId,
        actorId: room.hostId,
        type: 'RSVP_REMINDER',
        title,
        body,
        data: { roomId: room.id, leadMinutes: 15 },
        targetId: room.id,
        targetType: 'room',
      });
    } catch (err) {
      logger.error('ext.reminder15: failed to notify', { err, userId, roomId: room.id });
    }
  }
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

  const rooms = await prisma.room.findMany({
    where: {
      scheduledFor: { gte: windowStart, lte: windowEnd },
      endedAt: null,
    },
    select: { id: true, scheduledFor: true },
  });

  for (const r of rooms) {
    if (!r.scheduledFor) continue;
    await scheduleReminder15(r.id, r.scheduledFor);
  }
};

export const startReminder15Worker = (): void => {
  if (worker) return;
  worker = new Worker<Reminder15JobData>(QUEUE_NAME, processReminder15, {
    connection: bullConnection(),
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
