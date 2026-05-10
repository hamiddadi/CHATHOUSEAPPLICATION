import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { prisma } from '../config/database';
import { notificationsService } from '../modules/notifications/notifications.service';

/**
 * BullMQ queue for scheduled-room reminders. A job is enqueued with a
 * `delay` of `scheduledFor - now - LEAD_TIME_MS` when a scheduled room is
 * created; the worker reads the RSVP list at fire time and writes one
 * Notification row per RSVP'd user, then flips the room's `isLive` flag on.
 *
 * Single worker per API process is fine for MVP. When we split workers
 * into their own service we'll disable the in-process worker via env flag.
 */

const QUEUE_NAME = 'event-reminders';
const LEAD_TIME_MS = 5 * 60 * 1000; // 5 minutes

export interface ReminderJobData {
  roomId: string;
}

// BullMQ requires maxRetriesPerRequest=null for blocking commands used by
// Worker/QueueEvents. We keep this connection distinct from the app's
// node-redis client (different driver, different semantics).
const bullConnection = (): ConnectionOptions =>
  new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

let queue: Queue<ReminderJobData> | null = null;
let worker: Worker<ReminderJobData> | null = null;

export const getRemindersQueue = (): Queue<ReminderJobData> => {
  if (!queue) {
    queue = new Queue<ReminderJobData>(QUEUE_NAME, { connection: bullConnection() });
  }
  return queue;
};

// BullMQ rejects `:` in custom job ids (it uses `:` internally for keys).
const jobIdForRoom = (roomId: string) => `room-reminder-${roomId}`;

/**
 * Schedule (or reschedule) a reminder. If `scheduledFor` is within the
 * LEAD_TIME window or in the past we skip — there's nothing useful to do.
 */
export const scheduleEventReminder = async (roomId: string, scheduledFor: Date): Promise<void> => {
  const delay = scheduledFor.getTime() - Date.now() - LEAD_TIME_MS;
  if (delay <= 0) return;
  const q = getRemindersQueue();
  // removeOnComplete prevents Redis key buildup; jobId keyed on roomId
  // lets `cancelEventReminder` target a specific scheduled room idempotently.
  await q.add(
    'remind',
    { roomId },
    {
      jobId: jobIdForRoom(roomId),
      delay,
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    },
  );
};

export const cancelEventReminder = async (roomId: string): Promise<void> => {
  const q = getRemindersQueue();
  const job = await q.getJob(jobIdForRoom(roomId));
  if (job) await job.remove();
};

/**
 * Worker handler — fired at `scheduledFor - 5min`. Broadcast a notification
 * to every user who RSVP'd, plus the host. Mark room live so clients that
 * already have the detail view cached flip their UI automatically.
 */
const processReminder = async (job: Job<ReminderJobData>): Promise<void> => {
  const room = await prisma.room.findUnique({
    where: { id: job.data.roomId },
    include: { rsvps: { select: { userId: true } } },
  });
  if (!room) {
    logger.warn('event-reminder: room not found', { roomId: job.data.roomId });
    return;
  }
  if (room.endedAt) return; // already cancelled or ended

  // ─── Auto-open: flip the scheduled room to live ───
  if (!room.isLive) {
    await prisma.room.update({
      where: { id: room.id },
      data: { isLive: true },
    });
    // Add host as first participant
    await prisma.participant.upsert({
      where: { userId_roomId: { userId: room.hostId, roomId: room.id } },
      create: { roomId: room.id, userId: room.hostId, role: 'HOST' },
      update: { leftAt: null, joinedAt: new Date() },
    });
    await prisma.room.update({
      where: { id: room.id },
      data: { participantCount: 1 },
    });
    // Broadcast hallway:room_created so live feeds light up. We import
    // lazily to avoid a circular import between queues → realtime → socket.
    const { emitHallwayRoomCreated } = await import('../socket/realtime');
    if (!room.isPrivate) {
      emitHallwayRoomCreated({
        id: room.id,
        title: room.title,
        hostId: room.hostId,
        clubId: room.clubId,
        isLive: true,
        scheduledFor: room.scheduledFor?.toISOString() ?? null,
        createdAt: room.createdAt.toISOString(),
      });
    }
    logger.info(`event-reminder: auto-opened room ${room.id}`);
  }

  const recipientIds = new Set<string>(room.rsvps.map(r => r.userId));
  recipientIds.add(room.hostId);

  // Club rooms: also notify every active club member who isn't already
  // covered via RSVP. The reminder is a "your community is live" signal,
  // not just a personal calendar ping.
  if (room.clubId) {
    const members = await prisma.clubMember.findMany({
      where: { clubId: room.clubId },
      select: { userId: true },
    });
    for (const m of members) recipientIds.add(m.userId);
  }

  if (recipientIds.size > 0) {
    await Promise.all(
      [...recipientIds].map(userId =>
        notificationsService.create({
          userId,
          type: 'ROOM_STARTED',
          title: 'Room starting soon',
          body: `"${room.title}" starts in 5 minutes`,
          data: { roomId: room.id },
          targetId: room.id,
          targetType: 'room',
        }),
      ),
    );
  }
  logger.info(`event-reminder: notified ${recipientIds.size} users for ${room.id}`);
};

export const startReminderWorker = (): Worker<ReminderJobData> => {
  if (worker) return worker;
  worker = new Worker<ReminderJobData>(QUEUE_NAME, processReminder, {
    connection: bullConnection(),
  });
  worker.on('failed', (job, err) => {
    logger.error('event-reminder job failed', {
      jobId: job?.id,
      err: err.message,
    });
  });
  return worker;
};

export const shutdownReminders = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
};
