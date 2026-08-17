import { prisma } from '../../../config/database';
import { AppError } from '../../../middlewares/error.middleware';
import { notificationsService } from '../../../modules/notifications/notifications.service';
import { cancelEventReminder, scheduleEventReminder } from '../../../queues/eventReminders';
import { logger } from '../../../config/logger';

/**
 * Cancel a scheduled event before it goes live.
 *
 * Pure addition — does not touch the existing rooms.service. We:
 *  1. Validate the caller is the host (no co-host shortcut for cancellation)
 *  2. Mark the room as ended (endedAt now) AND canceledAt so a cancellation
 *     is distinguishable from a normal end in the feed/history
 *  3. Cancel the BullMQ reminder so the 5-min push doesn't fire
 *  4. Cancel the 15-min reminder (new worker) too
 *  5. Notify every RSVP'd user with a dedicated ROOM_CANCELED notification
 */
export const extEventsService = {
  async cancel(userId: string, roomId: string, reason?: string): Promise<{ notified: number }> {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        rsvps: {
          where: {
            user: {
              deletedAt: null,
              blocksCreated: { none: { blockedId: userId } },
              blocksReceived: { none: { blockerId: userId } },
            },
          },
          select: { userId: true },
        },
      },
    });
    if (!room) throw new AppError('ROOM_001');
    if (room.hostId !== userId) throw new AppError('AUTH_008'); // forbidden
    if (room.endedAt) throw new AppError('ROOM_002', 'Already ended');
    if (!room.scheduledFor) throw new AppError('ROOM_002', 'Room is not a scheduled event');
    // EVEN-01: `go-live` never clears `scheduledFor`, so a room already flipped
    // live still passes the `scheduledFor` check. Cancel is reserved for events
    // that haven't started — reject a live room rather than leave participants
    // and the SFU session orphaned by the partial soft-close below.
    if (room.isLive)
      throw new AppError('ROOM_002', 'Room is already live — end it instead of canceling');

    // 1. Soft close: set endedAt AND canceledAt so a canceled event is
    //    distinct from a normally ended room (feed/history can tell them apart).
    const now = new Date();
    const transitioned = await prisma.room.updateMany({
      where: {
        id: roomId,
        hostId: userId,
        endedAt: null,
        isLive: false,
        scheduledFor: room.scheduledFor,
      },
      data: { endedAt: now, canceledAt: now, isLive: false },
    });
    if (transitioned.count === 0) {
      const latest = await prisma.room.findUnique({
        where: { id: roomId },
        select: { hostId: true, endedAt: true, canceledAt: true, isLive: true },
      });
      // A retried/concurrent cancellation is idempotent and must not fan out
      // duplicate notifications.
      if (latest?.hostId === userId && latest.canceledAt) return { notified: 0 };
      if (!latest) throw new AppError('ROOM_001');
      if (latest.hostId !== userId) throw new AppError('AUTH_008');
      if (latest.isLive) throw new AppError('ROOM_002', 'Room is already live');
      if (latest.endedAt) throw new AppError('ROOM_002', 'Already ended');
      throw new AppError('ROOM_013');
    }

    // 2. Cancel both reminder queues. The 15-min one is best-effort.
    try {
      await cancelEventReminder(roomId);
    } catch (err) {
      logger.warn('ext.events.cancel: cancelEventReminder failed', { err, roomId });
    }

    // 3. Fan-out cancellation notification to RSVPs + host (the host gets one
    // too as confirmation receipt). De-dup userIds in case host RSVP'd.
    const recipients = Array.from(new Set([room.hostId, ...room.rsvps.map(r => r.userId)]));
    const title = 'Event canceled';
    const body = reason
      ? `"${room.title}" was canceled — ${reason}`
      : `"${room.title}" was canceled by the host`;

    let notified = 0;
    for (const recipientId of recipients) {
      try {
        await notificationsService.create({
          userId: recipientId,
          actorId: room.hostId,
          type: 'ROOM_CANCELED', // dedicated cancellation type (not the ROOM_STARTED bucket)
          title,
          body,
          data: { eventCancel: true, roomId, reason: reason ?? null },
          targetId: roomId,
          targetType: 'room',
          dedupeKey: `room-canceled:${roomId}:${recipientId}`,
        });
        notified += 1;
      } catch (err) {
        logger.error('ext.events.cancel: failed to notify', { err, userId: recipientId, roomId });
      }
    }

    return { notified };
  },

  /**
   * Reschedule a not-yet-live event: move its start time (and optionally
   * rename it), then re-arm both reminder queues for the new time. Host-only.
   */
  async reschedule(
    userId: string,
    roomId: string,
    input: { scheduledFor: Date; title?: string },
  ): Promise<{ rescheduled: true; scheduledFor: string }> {
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new AppError('ROOM_001');
    if (room.hostId !== userId) throw new AppError('AUTH_008');
    if (room.endedAt) throw new AppError('ROOM_002', 'Already ended');
    if (!room.scheduledFor) throw new AppError('ROOM_002', 'Room is not a scheduled event');
    if (room.isLive) throw new AppError('ROOM_002', 'Room is already live');
    if (input.scheduledFor.getTime() <= Date.now())
      throw new AppError('ROOM_002', 'New time must be in the future');

    const transitioned = await prisma.room.updateMany({
      where: {
        id: roomId,
        hostId: userId,
        endedAt: null,
        isLive: false,
        scheduledFor: room.scheduledFor,
      },
      data: {
        scheduledFor: input.scheduledFor,
        ...(input.title !== undefined ? { title: input.title } : {}),
      },
    });
    if (transitioned.count === 0) {
      const latest = await prisma.room.findUnique({
        where: { id: roomId },
        select: {
          hostId: true,
          endedAt: true,
          isLive: true,
          scheduledFor: true,
          title: true,
        },
      });
      if (!latest) throw new AppError('ROOM_001');
      if (latest.hostId !== userId) throw new AppError('AUTH_008');
      if (latest.isLive) throw new AppError('ROOM_002', 'Room is already live');
      if (latest.endedAt) throw new AppError('ROOM_002', 'Already ended');
      const sameTime = latest.scheduledFor?.getTime() === input.scheduledFor.getTime();
      const sameTitle = input.title === undefined || latest.title === input.title;
      // Same desired state means this is a safe retry. Re-arm reminders below
      // so a process crash between the DB transition and queue update heals.
      if (!sameTime || !sameTitle) throw new AppError('ROOM_013');
    }

    // Re-arm both reminder queues for the new time (cancel old → schedule new).
    try {
      await cancelEventReminder(roomId);
      await scheduleEventReminder(roomId, input.scheduledFor);
    } catch (err) {
      logger.warn('ext.events.reschedule: reminder re-arm failed', { err, roomId });
    }

    return { rescheduled: true as const, scheduledFor: input.scheduledFor.toISOString() };
  },
};
