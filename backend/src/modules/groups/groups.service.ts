import { MediaKind, type MessageKind, type Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { mediaService } from '../media/media.service';
import { lockUserRows } from '../social/relationship-lock';
import { emitGroupMessage } from '../../socket/realtime';
import { runIdempotentCreate } from '../../utils/idempotency';
import { scheduleBackgroundTask } from '../../utils/backgroundTasks';
import type {
  AddGroupMembersInput,
  CreateGroupInput,
  ListGroupMessagesInput,
  RenameGroupInput,
  SendGroupMessageInput,
  SendGroupVoiceInput,
} from './groups.schema';

const publicUser = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

interface PublicUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const toUser = (u: PublicUser) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
});

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/**
 * Groups must honour the Block table the same way DMs do (see
 * chat.service `assertCanMessage`): a block is a symmetric cut, so a blocked
 * user must not be able to reach their blocker through a group either. This
 * asserts that `userId` shares no block (in EITHER direction) with any id in
 * `others`. Throws GROUP_006 on the first offending pair.
 *
 * Without this, groups were a documented blocking bypass (audit 28/06): a
 * blocked user could create a group with, be added to, or message their
 * blocker. One indexed read over the Block table covers every candidate id.
 */
const assertNoBlockBetween = async (userId: string, others: string[]): Promise<void> => {
  const candidates = others.filter(id => id !== userId);
  if (candidates.length === 0) return;
  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: candidates } },
        { blockedId: userId, blockerId: { in: candidates } },
      ],
    },
    select: { id: true },
  });
  if (blocked) throw new AppError('GROUP_006');
};

/**
 * Pairwise block gate over the WHOLE membership. `assertNoBlockBetween` only
 * tests one pivot user against the rest, so it never catches a block between
 * two *other* members — e.g. a third party C creating a group [C, A, B] where
 * A blocked B, or adding a batch [A, B] where A blocked B. Both slipped the
 * pivot check and inserted a blocked pair into a shared group (audit 28/06).
 *
 * One indexed read fetches every Block whose blocker AND blocked are both in
 * `members`; any such row is, by definition, a blocked pair inside the group
 * (in either direction — `@@unique([blockerId, blockedId])` is directional, so
 * both A→B and B→A land here). Throws GROUP_006 on the first offending pair.
 */
const assertNoBlockWithinTransaction = async (
  tx: Prisma.TransactionClient,
  members: string[],
): Promise<void> => {
  const ids = uniq(members);
  if (ids.length < 2) return;
  const blocked = await tx.block.findFirst({
    where: { blockerId: { in: ids }, blockedId: { in: ids } },
    select: { id: true },
  });
  if (blocked) throw new AppError('GROUP_006');
};

/**
 * Group creation/member admission is a sensitive social action. The caller
 * may only add users they actively follow; PENDING private-account requests
 * are deliberately not sufficient.
 */
const assertAcceptedFollows = async (
  tx: Prisma.TransactionClient,
  actorId: string,
  targetIds: string[],
): Promise<void> => {
  const targets = uniq(targetIds).filter(id => id !== actorId);
  if (targets.length === 0) return;
  const accepted = await tx.follow.count({
    where: {
      followerId: actorId,
      followingId: { in: targets },
      status: 'ACCEPTED',
    },
  });
  if (accepted !== targets.length) throw new AppError('GROUP_007');
};

// A GroupMessage row joined with its sender, as returned by the Prisma queries
// below. Voice notes carry { kind: 'VOICE', audioUrl, audioDurationMs } and a
// null content; text messages carry content and leave the audio fields null.
interface RawGroupMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  kind: MessageKind;
  audioUrl: string | null;
  audioDurationMs: number | null;
  createdAt: Date;
  sender: PublicUser;
}

// Single source of truth for the wire shape of a group message — used by the
// list endpoint, the realtime fan-out, and both send paths so text and voice
// messages look identical to the client (just different `kind`).
const toMessagePayload = (m: RawGroupMessage) => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  kind: m.kind,
  content: m.content,
  audioUrl: m.audioUrl,
  durationMs: m.audioDurationMs,
  createdAt: m.createdAt,
  sender: toUser(m.sender),
});

export const groupsService = {
  /**
   * Load a conversation and assert the caller is a member. Returns the
   * conversation with its members (each including the public user fields).
   */
  async requireMembership(userId: string, conversationId: string) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          where: { user: { deletedAt: null } },
          include: { user: { select: publicUser } },
        },
      },
    });
    if (!conv) throw new AppError('GROUP_001');
    if (!conv.members.some(m => m.userId === userId)) throw new AppError('GROUP_002');
    return conv;
  },

  async create(userId: string, input: CreateGroupInput, idempotencyKey?: string) {
    // The creator is always a member; dedupe and drop any self-reference from
    // the requested members so a group is creator + ≥2 distinct others.
    const others = uniq(input.memberIds).filter(id => id !== userId);
    if (others.length < 2) throw new AppError('GROUP_003');

    const allMemberIds = [userId, ...others];

    const creation = await runIdempotentCreate({
      userId,
      scope: 'groups.create',
      key: idempotencyKey,
      payload: input,
      create: async tx => {
        // Serialize group admission with follow/block mutations, then re-check
        // every authorization fact inside the same transaction as insertion.
        const lockedIds = await lockUserRows(tx, allMemberIds);
        if (lockedIds.length !== allMemberIds.length) throw new AppError('USER_001');
        const activeUsers = await tx.user.count({
          where: { id: { in: allMemberIds }, deletedAt: null },
        });
        if (activeUsers !== allMemberIds.length) throw new AppError('USER_001');
        await assertNoBlockWithinTransaction(tx, allMemberIds);
        await assertAcceptedFollows(tx, userId, others);

        const conv = await tx.conversation.create({
          data: {
            title: input.title,
            ownerId: userId,
            members: { create: allMemberIds.map(id => ({ userId: id })) },
          },
          select: { id: true },
        });
        return conv.id;
      },
    });

    return this.detail(userId, creation.resourceId);
  },

  /** All group conversations the user belongs to, newest activity first. */
  async list(userId: string) {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            members: {
              where: { user: { deletedAt: null } },
              include: { user: { select: publicUser } },
            },
            messages: {
              where: { sender: { deletedAt: null } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { sender: { select: publicUser } },
            },
          },
        },
      },
    });

    const summaries = await Promise.all(
      memberships.map(async m => {
        const conv = m.conversation;
        const unreadCount = await prisma.groupMessage.count({
          where: {
            conversationId: conv.id,
            senderId: { not: userId },
            sender: { deletedAt: null },
            ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
          },
        });
        const last = conv.messages[0] ?? null;
        return this.serialize(conv, last, unreadCount);
      }),
    );

    return summaries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },

  async detail(userId: string, conversationId: string) {
    const conv = await this.requireMembership(userId, conversationId);
    const membership = conv.members.find(m => m.userId === userId);
    const last = await prisma.groupMessage.findFirst({
      where: { conversationId, sender: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: publicUser } },
    });
    const unreadCount = await prisma.groupMessage.count({
      where: {
        conversationId,
        senderId: { not: userId },
        sender: { deletedAt: null },
        ...(membership?.lastReadAt ? { createdAt: { gt: membership.lastReadAt } } : {}),
      },
    });
    return this.serialize(conv, last, unreadCount);
  },

  async listMessages(userId: string, conversationId: string, input: ListGroupMessagesInput) {
    await this.requireMembership(userId, conversationId);
    const messages = await prisma.groupMessage.findMany({
      where: {
        conversationId,
        sender: { deletedAt: null },
        ...(input.before ? { createdAt: { lt: new Date(input.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      include: { sender: { select: publicUser } },
    });
    return messages.reverse().map(toMessagePayload);
  },

  async send(
    userId: string,
    conversationId: string,
    input: SendGroupMessageInput,
    idempotencyKey?: string,
  ) {
    const conv = await this.requireMembership(userId, conversationId);
    const memberIds = conv.members.map(m => m.userId);

    // A blocked user must not reach their blocker via a shared group message.
    await assertNoBlockBetween(userId, memberIds);

    const creation = await runIdempotentCreate({
      userId,
      scope: `groups.message:${conversationId}`,
      key: idempotencyKey,
      payload: { kind: 'TEXT', ...input },
      create: async tx => {
        const created = await tx.groupMessage.create({
          data: { conversationId, senderId: userId, content: input.content },
          select: { id: true },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
        return created.id;
      },
    });
    const msg = await prisma.groupMessage.findUnique({
      where: { id: creation.resourceId },
      include: { sender: { select: publicUser } },
    });
    if (!msg) throw new AppError('GROUP_001');

    const payload = toMessagePayload(msg);
    if (creation.replayed) return payload;

    // Realtime fan-out to every member (sender included, so their other
    // devices stay in sync).
    emitGroupMessage(memberIds, payload);

    // Offline fallback: a NEW_MESSAGE notification for every OTHER member.
    const handle = msg.sender.displayName ?? msg.sender.username ?? 'Someone';
    const title = conv.title ?? handle;
    await Promise.all(
      memberIds
        .filter(memberId => memberId !== userId)
        .map(memberId =>
          scheduleBackgroundTask(
            notificationsService.create({
              userId: memberId,
              type: 'NEW_MESSAGE',
              title,
              body: `${handle}: ${input.content.slice(0, 140)}`,
              data: { conversationId, senderId: userId, conversation: 'group' },
            }),
            err =>
              logger.warn('group message notification failed', {
                err,
                conversationId,
                memberId,
              }),
          ),
        ),
    );

    return payload;
  },

  /**
   * Send an async voice note to a group. The client has already uploaded the
   * clip to /upload/voice; we persist a VOICE-kind message pointing at the
   * stored URL, fan it out in realtime, and notify the other members. Mirrors
   * {@link send} but with a 🎤 notification body instead of a text preview.
   */
  async sendVoice(
    userId: string,
    conversationId: string,
    input: SendGroupVoiceInput,
    idempotencyKey?: string,
  ) {
    const conv = await this.requireMembership(userId, conversationId);
    const memberIds = conv.members.map(m => m.userId);

    // A blocked user must not reach their blocker via a shared group voice note.
    await assertNoBlockBetween(userId, memberIds);
    await mediaService.assertOwnedMediaUrl(userId, input.audioUrl, MediaKind.VOICE);

    const creation = await runIdempotentCreate({
      userId,
      scope: `groups.message:${conversationId}`,
      key: idempotencyKey,
      payload: { kind: 'VOICE', ...input },
      create: async tx => {
        const created = await tx.groupMessage.create({
          data: {
            conversationId,
            senderId: userId,
            kind: 'VOICE',
            audioUrl: input.audioUrl,
            audioDurationMs: input.durationMs,
          },
          select: { id: true },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: new Date() },
        });
        return created.id;
      },
    });
    const msg = await prisma.groupMessage.findUnique({
      where: { id: creation.resourceId },
      include: { sender: { select: publicUser } },
    });
    if (!msg) throw new AppError('GROUP_001');

    const payload = toMessagePayload(msg);
    if (creation.replayed) return payload;
    emitGroupMessage(memberIds, payload);

    const handle = msg.sender.displayName ?? msg.sender.username ?? 'Someone';
    const title = conv.title ?? handle;
    await Promise.all(
      memberIds
        .filter(memberId => memberId !== userId)
        .map(memberId =>
          scheduleBackgroundTask(
            notificationsService.create({
              userId: memberId,
              type: 'NEW_MESSAGE',
              title,
              body: `${handle}: 🎤 Voice message`,
              data: { conversationId, senderId: userId, conversation: 'group' },
            }),
            err =>
              logger.warn('group voice notification failed', {
                err,
                conversationId,
                memberId,
              }),
          ),
        ),
    );

    return payload;
  },

  async markRead(userId: string, conversationId: string) {
    await this.requireMembership(userId, conversationId);
    await prisma.conversationMember.updateMany({
      where: { conversationId, userId },
      data: { lastReadAt: new Date() },
    });
    return { read: true as const };
  },

  async addMembers(
    userId: string,
    conversationId: string,
    input: AddGroupMembersInput,
    idempotencyKey?: string,
  ) {
    const mutation = await runIdempotentCreate({
      userId,
      scope: `groups.add-members:${conversationId}`,
      key: idempotencyKey,
      payload: input,
      create: async tx => {
        const lockedConversation = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
        if (lockedConversation.length === 0) throw new AppError('GROUP_001');

        const conv = await tx.conversation.findUnique({
          where: { id: conversationId },
          select: { members: { select: { userId: true } } },
        });
        if (!conv) throw new AppError('GROUP_001');
        if (!conv.members.some(member => member.userId === userId)) {
          throw new AppError('GROUP_002');
        }

        const existingIds = new Set(conv.members.map(member => member.userId));
        const toAdd = uniq(input.userIds).filter(id => !existingIds.has(id));
        if (toAdd.length === 0) return conversationId;

        const resultingIds = [...existingIds, ...toAdd];
        const lockedUsers = await lockUserRows(tx, resultingIds);
        if (lockedUsers.length !== resultingIds.length) throw new AppError('USER_001');
        const activeTargets = await tx.user.count({
          where: { id: { in: toAdd }, deletedAt: null },
        });
        if (activeTargets !== toAdd.length) throw new AppError('USER_001');

        await assertNoBlockWithinTransaction(tx, resultingIds);
        await assertAcceptedFollows(tx, userId, toAdd);
        await tx.conversationMember.createMany({
          data: toAdd.map(id => ({ conversationId, userId: id })),
          skipDuplicates: true,
        });
        return conversationId;
      },
    });
    return this.detail(userId, mutation.resourceId);
  },

  async rename(userId: string, conversationId: string, input: RenameGroupInput) {
    // Any member can rename the thread (Clubhouse-style group chats). An empty
    // title (normalised to null by the schema) reverts to the auto name.
    await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      if (locked.length === 0) throw new AppError('GROUP_001');
      const membership = await tx.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
        select: { id: true },
      });
      if (!membership) throw new AppError('GROUP_002');
      await tx.conversation.update({
        where: { id: conversationId },
        data: { title: input.title },
      });
    });
    return this.detail(userId, conversationId);
  },

  async removeMember(userId: string, conversationId: string, targetId: string) {
    await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      if (locked.length === 0) throw new AppError('GROUP_001');
      const conv = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: {
          ownerId: true,
          members: { where: { userId }, select: { id: true }, take: 1 },
        },
      });
      if (!conv) throw new AppError('GROUP_001');
      if (conv.members.length === 0) throw new AppError('GROUP_002');
      if (conv.ownerId !== userId) throw new AppError('GROUP_004');
      if (targetId === userId) throw new AppError('GROUP_005');
      await tx.conversationMember.deleteMany({
        where: { conversationId, userId: targetId },
      });
    });
    return this.detail(userId, conversationId);
  },

  async leave(userId: string, conversationId: string) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
      const conv = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: {
          ownerId: true,
          members: { where: { userId }, select: { id: true }, take: 1 },
        },
      });
      // Replayed leave after a successful response loss is a successful no-op.
      if (!conv || conv.members.length === 0) return;

      await tx.conversationMember.deleteMany({
        where: { conversationId, userId },
      });
      const oldest = await tx.conversationMember.findFirst({
        where: { conversationId, user: { deletedAt: null } },
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        select: { userId: true },
      });
      if (!oldest) {
        await tx.conversation.delete({ where: { id: conversationId } });
      } else if (conv.ownerId === userId) {
        // Transfer ownership in the same commit as the owner membership delete.
        await tx.conversation.update({
          where: { id: conversationId },
          data: { ownerId: oldest.userId },
        });
      }
    });
    return { left: true as const };
  },

  /** Shape a conversation (+ its last message + unread tally) for the client. */
  serialize(
    conv: {
      id: string;
      title: string | null;
      ownerId: string;
      updatedAt: Date;
      members: { user: PublicUser }[];
    },
    lastMessage: {
      id: string;
      senderId: string;
      content: string | null;
      kind: MessageKind;
      createdAt: Date;
    } | null,
    unreadCount: number,
  ) {
    return {
      id: conv.id,
      title: conv.title,
      ownerId: conv.ownerId,
      members: conv.members.map(m => toUser(m.user)),
      // `kind` lets the client render a "🎤 Voice message" preview instead of
      // the (null) content for voice notes.
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            senderId: lastMessage.senderId,
            content: lastMessage.content,
            kind: lastMessage.kind,
            createdAt: lastMessage.createdAt,
          }
        : null,
      unreadCount,
      updatedAt: conv.updatedAt,
    };
  },
};
