import type { OutboxEvent, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { registerOutboxHandler, wakeAndProcessOutbox } from '../../workers/outbox.worker';
import { notificationsService } from './notifications.service';

export const NOTIFICATION_DELIVERY_TOPIC = 'notification.deliver';

/**
 * Canonical envelope used by domain transactions that persist a notification
 * and its delivery hand-off together. The stable notification id is both the
 * downstream deduplication key and the only personal identifier retained in
 * the short-lived outbox payload.
 */
export const notificationDeliveryOutboxData = (
  notificationId: string,
  aggregateId: string,
): Prisma.OutboxEventCreateManyInput => ({
  eventKey: `notification-delivery:${notificationId}`,
  topic: NOTIFICATION_DELIVERY_TOPIC,
  aggregateId,
  payload: { notificationId },
});

type NotificationDeliveryPayload = { notificationId: string };

const payloadOf = (event: OutboxEvent): NotificationDeliveryPayload => {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('Invalid notification outbox payload');
  }
  const notificationId = (event.payload as Record<string, unknown>)['notificationId'];
  if (typeof notificationId !== 'string' || notificationId.length === 0) {
    throw new Error('Missing notificationId in outbox payload');
  }
  return { notificationId };
};

const isCreateRoomCoHostInvite = (data: unknown): boolean =>
  !!data &&
  typeof data === 'object' &&
  !Array.isArray(data) &&
  (data as Record<string, unknown>)['coHost'] === true;

const dataRecord = (data: unknown): Record<string, unknown> | null =>
  data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;

const revokeNotification = async (notificationId: string, userId: string): Promise<void> => {
  const deleted = await prisma.notification.deleteMany({ where: { id: notificationId } });
  if (deleted.count > 0) await notificationsService.refreshUnreadCount(userId);
};

const deliverNotification = async (event: OutboxEvent): Promise<void> => {
  const { notificationId } = payloadOf(event);
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  // Relationship revocation can delete the notification while leaving the
  // audit-free outbox envelope behind. That envelope is a successful no-op.
  if (!notification) return;

  if (notification.type === 'NEW_MESSAGE') {
    const data = dataRecord(notification.data);
    const actorId = notification.actorId;
    const messageId =
      notification.targetId ?? (typeof data?.['messageId'] === 'string' ? data['messageId'] : null);
    const conversation = data?.['conversation'];
    if (!actorId || !messageId || (conversation !== 'dm' && conversation !== 'group')) {
      await revokeNotification(notification.id, notification.userId);
      return;
    }

    const [activeUsers, block, sourceExists] = await Promise.all([
      prisma.user.count({
        where: {
          id: { in: [actorId, notification.userId] },
          deletedAt: null,
          OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
        },
      }),
      prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: actorId, blockedId: notification.userId },
            { blockerId: notification.userId, blockedId: actorId },
          ],
        },
        select: { id: true },
      }),
      conversation === 'dm'
        ? prisma.message.findFirst({
            where: {
              id: messageId,
              senderId: actorId,
              receiverId: notification.userId,
              roomId: null,
            },
            select: { id: true },
          })
        : prisma.groupMessage.findFirst({
            where: {
              id: messageId,
              senderId: actorId,
              conversation: {
                members: { some: { userId: notification.userId } },
              },
            },
            select: { id: true },
          }),
    ]);
    if (activeUsers !== 2 || block || !sourceExists) {
      await revokeNotification(notification.id, notification.userId);
      return;
    }
  }

  // Only create-room co-host invitations require the durable SPEAKER grant.
  // Ordinary room invites/pings share the topic but retain their own policy.
  if (notification.type === 'ROOM_INVITE' && isCreateRoomCoHostInvite(notification.data)) {
    const actorId = notification.actorId;
    const roomId = notification.targetType === 'room' ? notification.targetId : null;
    if (!actorId || !roomId) {
      await revokeNotification(notification.id, notification.userId);
      return;
    }

    const [activeUsers, block, durableGrant] = await Promise.all([
      prisma.user.count({
        where: {
          id: { in: [actorId, notification.userId] },
          deletedAt: null,
          OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
        },
      }),
      prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: actorId, blockedId: notification.userId },
            { blockerId: notification.userId, blockedId: actorId },
          ],
        },
        select: { id: true },
      }),
      prisma.participant.findFirst({
        where: {
          roomId,
          userId: notification.userId,
          role: 'SPEAKER',
          room: { hostId: actorId, endedAt: null, canceledAt: null },
        },
        select: { id: true },
      }),
    ]);
    if (activeUsers !== 2 || block || !durableGrant) {
      await revokeNotification(notification.id, notification.userId);
      return;
    }
  }

  await notificationsService.deliverPersistedStrict(notification, { verifyExists: true });
};

registerOutboxHandler(NOTIFICATION_DELIVERY_TOPIC, deliverNotification);

export const wakeNotificationDelivery = (aggregateId: string): Promise<number> =>
  wakeAndProcessOutbox(NOTIFICATION_DELIVERY_TOPIC, aggregateId);

export const wakeRoomInviteDelivery = (roomId: string): Promise<number> =>
  wakeNotificationDelivery(roomId);
