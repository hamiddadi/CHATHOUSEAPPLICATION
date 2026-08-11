import type { OutboxEvent, Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { emitChatMessageToUsers, emitGroupMessage } from '../../socket/realtime';
import { registerOutboxHandler, wakeAndProcessOutbox } from '../../workers/outbox.worker';

export type DurableMessageDeliveryKind = 'direct' | 'group';

export const DIRECT_MESSAGE_DELIVERY_TOPIC = 'chat.message.deliver';
export const GROUP_MESSAGE_DELIVERY_TOPIC = 'group.message.deliver';

const topicFor = (kind: DurableMessageDeliveryKind): string =>
  kind === 'direct' ? DIRECT_MESSAGE_DELIVERY_TOPIC : GROUP_MESSAGE_DELIVERY_TOPIC;

/** A stable event envelope that can be inserted inside the message transaction. */
export const messageDeliveryOutboxData = (
  kind: DurableMessageDeliveryKind,
  messageId: string,
): Prisma.OutboxEventCreateManyInput => ({
  eventKey: `${topicFor(kind)}:${messageId}`,
  topic: topicFor(kind),
  aggregateId: messageId,
  payload: { messageId },
});

const messageIdOf = (event: OutboxEvent): string => {
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('Invalid message outbox payload');
  }
  const messageId = (event.payload as Record<string, unknown>)['messageId'];
  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw new Error('Missing messageId in outbox payload');
  }
  return messageId;
};

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

const deliverDirectMessage = async (event: OutboxEvent): Promise<void> => {
  const messageId = messageIdOf(event);
  const message = await prisma.message.findFirst({
    where: { id: messageId, roomId: null, receiverId: { not: null } },
    include: { sender: { select: publicUser } },
  });
  // Account deletion can cascade the committed message before its envelope is
  // claimed. That is a successful no-op, not a poison event.
  if (!message?.receiverId) return;
  const receiverId = message.receiverId;
  const [activeUsers, block] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: [message.senderId, receiverId] },
        deletedAt: null,
        OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
      },
      select: { id: true },
    }),
    prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: message.senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: message.senderId },
        ],
      },
      select: { id: true },
    }),
  ]);
  const activeIds = new Set(activeUsers.map(user => user.id));
  // A suspension/deletion that commits before the outbox claim revokes the
  // sender's pending fanout. The message remains a durable audit/history row,
  // but it must not surface through a later retry while the actor is inactive.
  if (!activeIds.has(message.senderId)) return;
  const recipients = [
    message.senderId,
    ...(!block && activeIds.has(receiverId) ? [receiverId] : []),
  ];
  if (recipients.length > 0) emitChatMessageToUsers(recipients, message);
};

const deliverGroupMessage = async (event: OutboxEvent): Promise<void> => {
  const messageId = messageIdOf(event);
  const message = await prisma.groupMessage.findUnique({
    where: { id: messageId },
    include: {
      sender: { select: publicUser },
      conversation: {
        select: {
          members: {
            where: {
              user: {
                deletedAt: null,
                OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],
              },
            },
            select: { userId: true },
          },
        },
      },
    },
  });
  if (!message) return;

  const activeMemberIds = message.conversation.members.map(member => member.userId);
  if (!activeMemberIds.includes(message.senderId)) return;
  const candidates = activeMemberIds.filter(userId => userId !== message.senderId);
  const blocks =
    candidates.length === 0
      ? []
      : await prisma.block.findMany({
          where: {
            OR: [
              { blockerId: message.senderId, blockedId: { in: candidates } },
              { blockedId: message.senderId, blockerId: { in: candidates } },
            ],
          },
          select: { blockerId: true, blockedId: true },
        });
  const blockedIds = new Set(
    blocks.map(block => (block.blockerId === message.senderId ? block.blockedId : block.blockerId)),
  );
  const recipients = activeMemberIds.filter(
    userId => userId === message.senderId || !blockedIds.has(userId),
  );

  emitGroupMessage(recipients, {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    kind: message.kind,
    content: message.content,
    audioUrl: message.audioUrl,
    durationMs: message.audioDurationMs,
    createdAt: message.createdAt,
    sender: message.sender,
  });
};

registerOutboxHandler(DIRECT_MESSAGE_DELIVERY_TOPIC, deliverDirectMessage);
registerOutboxHandler(GROUP_MESSAGE_DELIVERY_TOPIC, deliverGroupMessage);

export const wakeMessageDelivery = (
  kind: DurableMessageDeliveryKind,
  messageId: string,
): Promise<number> => wakeAndProcessOutbox(topicFor(kind), messageId);

export const _internals = { deliverDirectMessage, deliverGroupMessage };
