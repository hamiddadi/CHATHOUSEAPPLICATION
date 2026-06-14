import { prisma } from '../../../config/database';
import { AppError } from '../../../middlewares/error.middleware';
import { notificationsService } from '../../../modules/notifications/notifications.service';
import { cancelEventReminder } from '../../../queues/eventReminders';
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
      include: { rsvps: { select: { userId: true } } },
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
    await prisma.room.update({
      where: { id: roomId },
      data: { endedAt: now, canceledAt: now, isLive: false },
    });

    // 2. Cancel both reminder queues. The 15-min one is best-effort.
    try {
      await cancelEventReminder(roomId);
    } catch (err) {
      logger.warn('ext.events.cancel: cancelEventReminder failed', { err, roomId });
    }
    try {
      const { cancelReminder15 } = await import('../../queues/reminder15');
      await cancelReminder15(roomId);
    } catch (err) {
      logger.warn('ext.events.cancel: cancelReminder15 failed', { err, roomId });
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
        });
        notified += 1;
      } catch (err) {
        logger.error('ext.events.cancel: failed to notify', { err, userId: recipientId, roomId });
      }
    }

    return { notified };
  },
};
