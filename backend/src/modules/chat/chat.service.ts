import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { emitChatMessage } from '../../socket/realtime';
import type { ListMessagesInput, SendMessageInput } from './chat.schema';

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

const conversationPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/**
 * Direct-message business rule: two users can only exchange DMs if they
 * follow each other. Enforced at the point of send (both REST and the
 * socket handler funnel through `chatService.send`), so there's no way
 * to bypass by skipping the API.
 */
const assertMutualFollow = async (a: string, b: string): Promise<void> => {
  const rows = await prisma.follow.findMany({
    where: {
      OR: [
        { followerId: a, followingId: b },
        { followerId: b, followingId: a },
      ],
    },
    select: { followerId: true, followingId: true },
  });
  const aFollowsB = rows.some(r => r.followerId === a && r.followingId === b);
  const bFollowsA = rows.some(r => r.followerId === b && r.followingId === a);
  if (!(aFollowsB && bFollowsA)) throw new AppError('CHAT_004');
};

export const chatService = {
  /**
   * Conversation list with cursor pagination.
   *
   * Note on accuracy: DM history has no dedicated `Conversation` table in
   * the current Prisma schema, so the per-peer aggregation is still derived
   * from the user's recent message window. We page the *conversation list*
   * via a cursor on the peer's `lastMessage.createdAt` (returning `limit`
   * conversations + a `nextCursor`), while keeping the unread tally scoped
   * to the same window. The window is sized generously relative to `limit`
   * so an active conversation can't crowd the others out of a single page.
   *
   * TODO(audit): introduce a `Conversation` model (groupBy on the user pair
   * + an indexed unread count per pair) to make `unreadCount` exact and the
   * list pageable purely at the DB level instead of aggregating in memory.
   *
   * `limit`/`cursor` are optional to keep the public signature
   * backward-compatible with existing callers.
   */
  async listConversations(userId: string, limit = 30, cursor?: string) {
    // Pull a window large enough to surface `limit` distinct peers even when
    // a single conversation is very chatty. Bounded so it stays a single
    // indexed query rather than an unbounded scan.
    const windowSize = Math.min(500, Math.max(100, limit * 10));
    const messages = await prisma.message.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        roomId: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: { select: publicUser },
      },
      take: windowSize,
    });

    const byPeer = new Map<
      string,
      {
        peerId: string;
        lastMessage: (typeof messages)[number];
        unreadCount: number;
      }
    >();

    for (const m of messages) {
      const peerId = m.senderId === userId ? (m.receiverId ?? '') : m.senderId;
      if (!peerId) continue;
      const entry = byPeer.get(peerId);
      if (!entry) {
        byPeer.set(peerId, {
          peerId,
          lastMessage: m,
          unreadCount: m.receiverId === userId && !m.isRead ? 1 : 0,
        });
      } else if (m.receiverId === userId && !m.isRead) {
        entry.unreadCount += 1;
      }
    }

    const peerIds = Array.from(byPeer.keys());
    const peers = await prisma.user.findMany({
      where: { id: { in: peerIds } },
      select: publicUser,
    });
    const peerById = new Map(peers.map(p => [p.id, p]));

    const sorted = Array.from(byPeer.values())
      .map(e => ({
        peer: peerById.get(e.peerId),
        lastMessage: e.lastMessage,
        unreadCount: e.unreadCount,
      }))
      .filter(c => c.peer)
      .sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime());

    // Cursor on lastMessage.createdAt: skip everything at or after the
    // supplied cursor, then return at most `limit` conversations.
    const cutoff = cursor ? new Date(cursor).getTime() : null;
    const filtered =
      cutoff === null ? sorted : sorted.filter(c => c.lastMessage.createdAt.getTime() < cutoff);
    const data = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextCursor = hasMore
      ? (data[data.length - 1]?.lastMessage.createdAt.toISOString() ?? null)
      : null;

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
    const peer = await prisma.user.findUnique({ where: { id: peerId }, select: publicUser });
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
    const [lo, hi] = conversationPair(userId, peerId);
    const messages = await prisma.message.findMany({
      where: {
        roomId: null,
        OR: [
          { senderId: lo, receiverId: hi },
          { senderId: hi, receiverId: lo },
        ],
        ...(input.before ? { createdAt: { lt: new Date(input.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      include: { sender: { select: publicUser } },
    });
    return messages.reverse();
  },

  async send(senderId: string, receiverId: string, input: SendMessageInput) {
    if (senderId === receiverId) throw new AppError('CHAT_001');
    const peer = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, username: true, displayName: true },
    });
    if (!peer) throw new AppError('USER_001');

    await assertMutualFollow(senderId, receiverId);

    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { username: true, displayName: true },
    });
    const handle = sender?.displayName ?? sender?.username ?? 'Someone';

    const msg = await prisma.message.create({
      data: {
        senderId,
        receiverId,
        content: input.content,
      },
      include: { sender: { select: publicUser } },
    });

    // Push the message to both parties in realtime. REST is the only send path
    // the clients use (they never emit `chat:send`), so this is what makes the
    // recipient's conversation list / unread badge / open thread update live.
    emitChatMessage(senderId, receiverId, msg);

    // Fire-and-forget notification + push. The realtime emit above handles the
    // in-app update; the Notification row is the offline fallback that lights
    // up the bell badge next launch.
    void notificationsService.create({
      userId: receiverId,
      type: 'NEW_MESSAGE',
      title: handle,
      body: input.content.slice(0, 160),
      data: { messageId: msg.id, senderId, conversation: 'dm' },
    });

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
