import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '../config/logger';
import { prisma } from '../config/database';
import { notificationsService } from '../modules/notifications/notifications.service';
import { bullConnection } from './connection';

/**
 * BullMQ queue for scheduled-room reminders. Two independent jobs are
 * enqueued per scheduled room:
 *
 *   1. `remind`  — fires at `scheduledFor - LEAD_TIME_MS` (T−5min). Reads the
 *      RSVP list and writes one Notification row per recipient. Pure notify.
 *   2. `go-live` — fires at exactly `scheduledFor` (T−0). Flips `isLive`,
 *      seats the host as first participant, and emits `hallway:room_created`.
 *
 * The two are decoupled so the auto-open happens at the EXACT scheduled
 * time rather than 5 minutes early. Both job ids are deterministic and
 * keyed on the room, so re-scheduling is idempotent (BullMQ dedupes on
 * jobId) and `cancelEventReminder` can target both.
 *
 * Single worker per API process is fine for MVP. When we split workers
 * into their own service we'll disable the in-process worker via env flag.
 */

const QUEUE_NAME = 'event-reminders';
const LEAD_TIME_MS = 5 * 60 * 1000; // 5 minutes

export type ReminderJobKind = 'remind' | 'go-live';

export interface ReminderJobData {
  roomId: string;
  kind: ReminderJobKind;
}

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
const goLiveJobIdForRoom = (roomId: string) => `room-golive-${roomId}`;

/**
 * Schedule (or reschedule) the T−5min reminder + the T−0 go-live flip.
 *
 * - Reminder (`remind`): skipped when `scheduledFor` is within the LEAD_TIME
 *   window or already past — there's nothing useful to notify about.
 * - Go-live (`go-live`): fires at exactly `scheduledFor`. When the room is
 *   programmed for <5min out or in the past (`delay <= 0`) we flip it live
 *   immediately rather than enqueueing a zero/negative delay.
 *
 * Both enqueues use deterministic jobIds so re-scheduling is idempotent.
 */
export const scheduleEventReminder = async (roomId: string, scheduledFor: Date): Promise<void> => {
  const q = getRemindersQueue();
  const now = Date.now();

  // ── 1. T−5min reminder (notification only) ──
  const reminderDelay = scheduledFor.getTime() - now - LEAD_TIME_MS;
  if (reminderDelay > 0) {
    // removeOnComplete prevents Redis key buildup; jobId keyed on roomId
    // lets `cancelEventReminder` target a specific scheduled room idempotently.
    await q.add(
      'remind',
      { roomId, kind: 'remind' },
      {
        jobId: jobIdForRoom(roomId),
        delay: reminderDelay,
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    );
  }

  // ── 2. T−0 go-live flip (decoupled from the reminder) ──
  const goLiveDelay = scheduledFor.getTime() - now;
  if (goLiveDelay <= 0) {
    // Programmed for <now (or so close the delay is non-positive): the room
    // should already be live, so flip it inline instead of queueing.
    await openScheduledRoom(roomId);
    return;
  }
  await q.add(
    'go-live',
    { roomId, kind: 'go-live' },
    {
      jobId: goLiveJobIdForRoom(roomId),
      delay: goLiveDelay,
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    },
  );
};

export const cancelEventReminder = async (roomId: string): Promise<void> => {
  const q = getRemindersQueue();
  const [reminderJob, goLiveJob] = await Promise.all([
    q.getJob(jobIdForRoom(roomId)),
    q.getJob(goLiveJobIdForRoom(roomId)),
  ]);
  if (reminderJob) await reminderJob.remove();
  if (goLiveJob) await goLiveJob.remove();
};

/**
 * Auto-open a scheduled room at its exact start time: flip `isLive`, seat the
 * host as the first participant, and broadcast `hallway:room_created` so live
 * feeds light up. Idempotent — a no-op if the room is already live, ended, or
 * gone. Called both from the `go-live` worker job and inline from
 * `scheduleEventReminder` when the room is programmed for now/the past.
 */
const openScheduledRoom = async (roomId: string): Promise<void> => {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) {
    logger.warn('event-reminder: go-live room not found', { roomId });
    return;
  }
  if (room.endedAt) return; // already cancelled or ended
  if (room.isLive) return; // already opened — keep idempotent

  await prisma.room.update({
    where: { id: room.id },
    // Stamp the real go-live time so the in-room timer counts from here, not
    // the (earlier) createdAt (#9).
    data: { isLive: true, liveAt: new Date() },
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

  // Start the Replay recording for scheduled rooms whose host opted in. Lazy
  // import keeps this off the queue→realtime cycle; gated/no-op when egress
  // isn't configured, and best-effort so it never blocks the go-live.
  if (room.recordingEnabled) {
    const { recordingsService } = await import('../modules/recordings/recordings.service');
    void recordingsService
      .startForRoom(room.id)
      .catch(err =>
        logger.warn('event-reminder: recording start failed', { err, roomId: room.id }),
      );
  }
};

/**
 * Reminder handler — fired at `scheduledFor - 5min`. Broadcast a notification
 * to every user who RSVP'd, plus the host. The live flip is no longer done
 * here; it happens at T−0 via the decoupled `go-live` job.
 */
const processReminder = async (job: Job<ReminderJobData>): Promise<void> => {
  // The `go-live` job only flips the room live; it shares this queue/worker
  // but does no notification fan-out.
  if (job.data.kind === 'go-live') {
    await openScheduledRoom(job.data.roomId);
    return;
  }

  const room = await prisma.room.findUnique({
    where: { id: job.data.roomId },
    include: { rsvps: { select: { userId: true } } },
  });
  if (!room) {
    logger.warn('event-reminder: room not found', { roomId: job.data.roomId });
    return;
  }
  if (room.endedAt) return; // already cancelled or ended

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

  // Fan-out in bounded batches. notificationsService.create does several DB
  // writes + a COUNT + a push dispatch per recipient; for a club of thousands
  // of members an unbounded Promise.all could exhaust the Prisma/Redis pools
  // and fail the job. Batching caps in-flight concurrency.
  // TODO(audit): for very large clubs, prefer a single createMany for the rows
  // plus one COUNT, and batch the push dispatch by recipient set.
  const ids = [...recipientIds];
  const BATCH = 50;
  for (let i = 0; i < ids.length; i += BATCH) {
    await Promise.all(
      ids.slice(i, i + BATCH).map(userId =>
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
