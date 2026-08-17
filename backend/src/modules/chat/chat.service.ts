import { MediaKind, Prisma, type MessageKind } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { mediaService } from '../media/media.service';
import { scheduleBackgroundTask } from '../../utils/backgroundTasks';
import { runIdempotentCreate } from '../../utils/idempotency';
import {
  notificationDeliveryOutboxData,
  wakeNotificationDelivery,
} from '../notifications/notification.outbox';
import { sendMessageSchema } from './chat.schema';
import type { ListMessagesInput, SendMessageInput, SendVoiceMessageInput } from './chat.schema';
import { assertCanDirectMessageWithinTransaction } from './chat.policy';
import { decodeChatCursor, encodeChatCursor } from './chat.cursor';
import { messageDeliveryOutboxData, wakeMessageDelivery } from './message.outbox';

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

const conversationPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

interface ConversationRow {
  peerId: string;
  peerUsername: string | null;
  peerDisplayName: string | null;
  peerAvatarUrl: string | null;
  messageId: string;
  messageContent: string | null;
  messageKind: MessageKind;
  messageAudioUrl: string | null;
  messageAudioDurationMs: number | null;
  messageSenderId: string;
  messageRoomId: string | null;
  messageReceiverId: string | null;
  messageIsRead: boolean;
  messageCreatedAt: Date;
  senderUsername: string | null;
  senderDisplayName: string | null;
  senderAvatarUrl: string | null;
  unreadCount: bigint;
}

export const chatService = {
  /**
   * Exact 1:1 conversation pagination, computed by PostgreSQL. The peer set
   * comes from the full DM history, while lateral indexed lookups select one
   * last message per peer and count only that page's unread messages. The
   * application therefore retains at most `limit + 1` rows, irrespective of
   * history size.
   *
   * New cursors contain `(createdAt,messageId)` so equal timestamps are
   * stable. Timestamp-only cursors emitted by older servers remain accepted;
   * their historical `< createdAt` semantics necessarily cannot distinguish
   * rows tied at the boundary.
   */
  async listConversations(userId: string, limit = 30, cursor?: string) {
    const pageSize = Math.min(500, Math.max(1, Math.trunc(limit)));
    const decodedCursor = cursor ? decodeChatCursor(cursor) : null;
    if (cursor && !decodedCursor) throw new AppError('VALIDATION_001');

    const cursorPredicate = decodedCursor
      ? decodedCursor.messageId
        ? Prisma.sql`AND (date_trunc('milliseconds', latest."createdAt"), latest."id") < (${decodedCursor.createdAt}, ${decodedCursor.messageId})`
        : Prisma.sql`AND date_trunc('milliseconds', latest."createdAt") < ${decodedCursor.createdAt}`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<ConversationRow[]>(Prisma.sql`
      WITH "peerIds" AS MATERIALIZED (
        SELECT message."receiverId" AS "peerId"
        FROM "Message" message
        WHERE message."senderId" = ${userId}
          AND message."receiverId" IS NOT NULL
          AND message."roomId" IS NULL
        UNION
        SELECT message."senderId" AS "peerId"
        FROM "Message" message
        WHERE message."receiverId" = ${userId}
          AND message."roomId" IS NULL
      ),
      page AS MATERIALIZED (
        SELECT
          peer.id AS "peerId",
          peer.username AS "peerUsername",
          peer."displayName" AS "peerDisplayName",
          peer."avatarUrl" AS "peerAvatarUrl",
          latest.id AS "messageId",
          latest.content AS "messageContent",
          latest.kind AS "messageKind",
          latest."audioUrl" AS "messageAudioUrl",
          latest."audioDurationMs" AS "messageAudioDurationMs",
          latest."senderId" AS "messageSenderId",
          latest."roomId" AS "messageRoomId",
          latest."receiverId" AS "messageReceiverId",
          latest."isRead" AS "messageIsRead",
          date_trunc('milliseconds', latest."createdAt") AS "messageCreatedAt"
        FROM "peerIds" peers
        JOIN "User" peer
          ON peer.id = peers."peerId"
         AND peer."deletedAt" IS NULL
        CROSS JOIN LATERAL (
          SELECT message.*
          FROM "Message" message
          WHERE message."roomId" IS NULL
            AND (
              (message."senderId" = ${userId} AND message."receiverId" = peers."peerId")
              OR
              (message."senderId" = peers."peerId" AND message."receiverId" = ${userId})
            )
          ORDER BY message."createdAt" DESC, message.id DESC
          LIMIT 1
        ) latest
        WHERE TRUE ${cursorPredicate}
        ORDER BY date_trunc('milliseconds', latest."createdAt") DESC, latest.id DESC
        LIMIT ${pageSize + 1}
      ),
      "unreadCounts" AS (
        SELECT
          unreadMessage."senderId" AS "peerId",
          COUNT(*)::bigint AS count
        FROM "Message" unreadMessage
        JOIN page unreadPeer ON unreadPeer."peerId" = unreadMessage."senderId"
        WHERE unreadMessage."roomId" IS NULL
          AND unreadMessage."receiverId" = ${userId}
          AND unreadMessage."isRead" = false
        GROUP BY unreadMessage."senderId"
      )
      SELECT
        page.*,
        sender.username AS "senderUsername",
        sender."displayName" AS "senderDisplayName",
        sender."avatarUrl" AS "senderAvatarUrl",
        COALESCE(unread.count, 0)::bigint AS "unreadCount"
      FROM page
      JOIN "User" sender ON sender.id = page."messageSenderId"
      LEFT JOIN "unreadCounts" unread ON unread."peerId" = page."peerId"
      ORDER BY page."messageCreatedAt" DESC, page."messageId" DESC
    `);

    const hasMore = rows.length > pageSize;
    const keptRows = hasMore ? rows.slice(0, pageSize) : rows;
    const data = keptRows.map(row => ({
      peer: {
        id: row.peerId,
        username: row.peerUsername,
        displayName: row.peerDisplayName,
        avatarUrl: row.peerAvatarUrl,
      },
      lastMessage: {
        id: row.messageId,
        content: row.messageContent,
        kind: row.messageKind,
        audioUrl: row.messageAudioUrl,
        audioDurationMs: row.messageAudioDurationMs,
        senderId: row.messageSenderId,
        roomId: row.messageRoomId,
        receiverId: row.messageReceiverId,
        isRead: row.messageIsRead,
        createdAt: row.messageCreatedAt,
        sender: {
          id: row.messageSenderId,
          username: row.senderUsername,
          displayName: row.senderDisplayName,
          avatarUrl: row.senderAvatarUrl,
        },
      },
      unreadCount: Number(row.unreadCount),
    }));
    const last = data[data.length - 1]?.lastMessage;
    const nextCursor = hasMore && last ? encodeChatCursor(last.createdAt, last.id) : null;

    return { data, nextCursor, hasMore };
  },

  /**
   * Single conversation summary for one peer — `{ peer, lastMessage,
   * unreadCount }`. Lets the client open a thread without scanning the full
   * conversations list (the O(all conversations) round-trip the mobile client
   * used to pay). `lastMessage` is null when there's no history yet.
   */
  async conversationWith(userId: string, peerId: string) {
    if (userId === peerId) throw new AppError('CHAT_001');
    const peer = await prisma.user.findFirst({
      where: { id: peerId, deletedAt: null },
      select: publicUser,
    });
    if (!peer) throw new AppError('USER_001');

    const [lo, hi] = conversationPair(userId, peerId);
    const lastMessage = await prisma.message.findFirst({
      where: {
        roomId: null,
        OR: [
          { senderId: lo, receiverId: hi },
          { senderId: hi, receiverId: lo },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: publicUser } },
    });
    const unreadCount = await prisma.message.count({
      where: { roomId: null, senderId: peerId, receiverId: userId, isRead: false },
    });
    return { peer, lastMessage, unreadCount };
  },

  async listWithPeer(userId: string, peerId: string, input: ListMessagesInput) {
    if (userId === peerId) throw new AppError('CHAT_001');
    const peer = await prisma.user.findFirst({
      where: { id: peerId, deletedAt: null },
      select: { id: true },
    });
    if (!peer) throw new AppError('USER_001');
    const [lo, hi] = conversationPair(userId, peerId);
    const decodedCursor = input.before ? decodeChatCursor(input.before) : null;
    if (input.before && !decodedCursor) throw new AppError('VALIDATION_001');
    const cursorWhere: Prisma.MessageWhereInput = decodedCursor
      ? decodedCursor.messageId
        ? {
            OR: [
              { createdAt: { lt: decodedCursor.createdAt } },
              { createdAt: decodedCursor.createdAt, id: { lt: decodedCursor.messageId } },
            ],
          }
        : { createdAt: { lt: decodedCursor.createdAt } }
      : {};
    const rows = await prisma.message.findMany({
      where: {
        roomId: null,
        AND: [
          {
            OR: [
              { senderId: lo, receiverId: hi },
              { senderId: hi, receiverId: lo },
            ],
          },
          cursorWhere,
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      include: { sender: { select: publicUser } },
    });
    const hasMore = rows.length > input.limit;
    const newestFirst = hasMore ? rows.slice(0, input.limit) : rows;
    const oldest = newestFirst[newestFirst.length - 1];
    const data = [...newestFirst].reverse();
    return {
      data,
      hasMore,
      nextCursor: hasMore && oldest ? encodeChatCursor(oldest.createdAt, oldest.id) : null,
    };
  },

  async send(
    senderId: string,
    receiverId: string,
    input: SendMessageInput,
    idempotencyKey?: string,
  ) {
    // `chat:send` reaches the service directly (without the REST controller),
    // so validate again at the shared persistence boundary. This keeps the
    // pre-publication content guard effective for both transports.
    const validatedInput = sendMessageSchema.parse(input);

    if (senderId === receiverId) throw new AppError('CHAT_001');
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { username: true, displayName: true },
    });
    const handle = sender?.displayName ?? sender?.username ?? 'Someone';

    const creation = await runIdempotentCreate({
      userId: senderId,
      scope: `chat.message:${receiverId}`,
      key: idempotencyKey,
      payload: { kind: 'TEXT', ...validatedInput },
      create: async tx => {
        await assertCanDirectMessageWithinTransaction(tx, senderId, receiverId);
        const created = await tx.message.create({
          data: {
            senderId,
            receiverId,
            content: validatedInput.content,
          },
          select: { id: true },
        });
        const notification = await tx.notification.create({
          data: {
            userId: receiverId,
            actorId: senderId,
            type: 'NEW_MESSAGE',
            title: handle,
            body: validatedInput.content.slice(0, 160),
            data: { messageId: created.id, senderId, conversation: 'dm' },
            targetId: created.id,
            targetType: 'message',
          },
          select: { id: true },
        });
        await tx.outboxEvent.createMany({
          data: [
            messageDeliveryOutboxData('direct', created.id),
            notificationDeliveryOutboxData(notification.id, created.id),
          ],
        });
        return created.id;
      },
    });
    const msg = await prisma.message.findUnique({
      where: { id: creation.resourceId },
      include: { sender: { select: publicUser } },
    });
    if (!msg) throw new AppError('CHAT_002');

    // Both the first response and an Idempotency-Key replay repair the same
    // durable aggregate. Stable outbox keys prevent duplicate database rows;
    // downstream socket/push delivery is explicitly at-least-once.
    await scheduleBackgroundTask(
      Promise.all([wakeMessageDelivery('direct', msg.id), wakeNotificationDelivery(msg.id)]),
      err =>
        logger.warn('chat message delivery wake failed', { err, receiverId, messageId: msg.id }),
    );

    return msg;
  },

  /**
   * Send an async voice note to a peer. The clip is already uploaded to
   * /upload/voice; we persist a VOICE-kind message and fan it out exactly like
   * {@link send} (same mutual-follow gate, same realtime emit), with a 🎤
   * notification body instead of the text preview.
   */
  async sendVoice(
    senderId: string,
    receiverId: string,
    input: SendVoiceMessageInput,
    idempotencyKey?: string,
  ) {
    if (senderId === receiverId) throw new AppError('CHAT_001');

    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { username: true, displayName: true },
    });
    const handle = sender?.displayName ?? sender?.username ?? 'Someone';

    const canonicalAudioUrl = mediaService.canonicalizeVoiceMediaUrl(input.audioUrl);
    const creation = await runIdempotentCreate({
      userId: senderId,
      scope: `chat.message:${receiverId}`,
      key: idempotencyKey,
      payload: { kind: 'VOICE', ...input, audioUrl: canonicalAudioUrl },
      create: async tx => {
        await assertCanDirectMessageWithinTransaction(tx, senderId, receiverId);
        const mediaObjectId = await mediaService.assertOwnedMediaUrlWithinTransaction(
          tx,
          senderId,
          canonicalAudioUrl,
          MediaKind.VOICE,
        );
        const created = await tx.message.create({
          data: {
            senderId,
            receiverId,
            kind: 'VOICE',
            audioUrl: canonicalAudioUrl,
            audioDurationMs: input.durationMs,
            mediaObjectId,
          },
          select: { id: true },
        });
        const notification = await tx.notification.create({
          data: {
            userId: receiverId,
            actorId: senderId,
            type: 'NEW_MESSAGE',
            title: handle,
            body: '🎤 Voice message',
            data: { messageId: created.id, senderId, conversation: 'dm' },
            targetId: created.id,
            targetType: 'message',
          },
          select: { id: true },
        });
        await tx.outboxEvent.createMany({
          data: [
            messageDeliveryOutboxData('direct', created.id),
            notificationDeliveryOutboxData(notification.id, created.id),
          ],
        });
        return created.id;
      },
    });
    const msg = await prisma.message.findUnique({
      where: { id: creation.resourceId },
      include: { sender: { select: publicUser } },
    });
    if (!msg) throw new AppError('CHAT_002');

    await scheduleBackgroundTask(
      Promise.all([wakeMessageDelivery('direct', msg.id), wakeNotificationDelivery(msg.id)]),
      err => logger.warn('chat voice delivery wake failed', { err, receiverId, messageId: msg.id }),
    );

    return msg;
  },

  async markRead(userId: string, messageId: string) {
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) throw new AppError('CHAT_002');
    if (msg.receiverId !== userId) throw new AppError('CHAT_003');
    if (msg.isRead) return { ...msg, isRead: true };
    return prisma.message.update({
      where: { id: messageId },
      data: { isRead: true },
    });
  },

  /**
   * Bulk-read every message FROM `peerId` TO `userId`. Drives the
   * "opened the thread → mark all read" UX without N round-trips.
   */
  async markReadWithPeer(userId: string, peerId: string) {
    if (userId === peerId) throw new AppError('CHAT_001');
    const res = await prisma.message.updateMany({
      where: {
        senderId: peerId,
        receiverId: userId,
        isRead: false,
        roomId: null,
      },
      data: { isRead: true },
    });
    return { updated: res.count };
  },

  /**
   * Total unread DMs across every conversation. Cheap — it's a single
   * indexed count query. The bell icon / badge hook calls this.
   */
  async unreadCount(userId: string) {
    const count = await prisma.message.count({
      where: { receiverId: userId, isRead: false, roomId: null },
    });
    return { count };
  },

  async remove(userId: string, messageId: string) {
    const msg = await prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) throw new AppError('CHAT_002');
    if (msg.senderId !== userId) throw new AppError('CHAT_003');
    await prisma.message.delete({ where: { id: messageId } });
    return { deleted: true };
  },
};
