import { prisma } from '../../config/database';
import { AppError } from '../../middlewares/error.middleware';
import { notificationsService } from '../notifications/notifications.service';
import { emitGroupMessage } from '../../socket/realtime';
import type {
  AddGroupMembersInput,
  CreateGroupInput,
  ListGroupMessagesInput,
  RenameGroupInput,
  SendGroupMessageInput,
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

export const groupsService = {
  /**
   * Load a conversation and assert the caller is a member. Returns the
   * conversation with its members (each including the public user fields).
   */
  async requireMembership(userId: string, conversationId: string) {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { members: { include: { user: { select: publicUser } } } },
    });
    if (!conv) throw new AppError('GROUP_001');
    if (!conv.members.some(m => m.userId === userId)) throw new AppError('GROUP_002');
    return conv;
  },

  async create(userId: string, input: CreateGroupInput) {
    // The creator is always a member; dedupe and drop any self-reference from
    // the requested members so a group is creator + ≥2 distinct others.
    const others = uniq(input.memberIds).filter(id => id !== userId);
    if (others.length < 2) throw new AppError('GROUP_003');

    const found = await prisma.user.findMany({
      where: { id: { in: others }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== others.length) throw new AppError('USER_001');

    const allMemberIds = [userId, ...others];
    const conv = await prisma.conversation.create({
      data: {
        title: input.title,
        ownerId: userId,
        members: { create: allMemberIds.map(id => ({ userId: id })) },
      },
      include: { members: { include: { user: { select: publicUser } } } },
    });

    return this.serialize(conv, null, 0);
  },

  /** All group conversations the user belongs to, newest activity first. */
  async list(userId: string) {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          include: {
            members: { include: { user: { select: publicUser } } },
            messages: {
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
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      include: { sender: { select: publicUser } },
    });
    const unreadCount = await prisma.groupMessage.count({
      where: {
        conversationId,
        senderId: { not: userId },
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
        ...(input.before ? { createdAt: { lt: new Date(input.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      include: { sender: { select: publicUser } },
    });
    return messages.reverse().map(m => ({
      id: m.id,
      conversationId,
      senderId: m.senderId,
      content: m.content,
      createdAt: m.createdAt,
      sender: toUser(m.sender),
    }));
  },

  async send(userId: string, conversationId: string, input: SendGroupMessageInput) {
    const conv = await this.requireMembership(userId, conversationId);
    const memberIds = conv.members.map(m => m.userId);

    const msg = await prisma.groupMessage.create({
      data: { conversationId, senderId: userId, content: input.content },
      include: { sender: { select: publicUser } },
    });
    // Bump the conversation so it floats to the top of everyone's list.
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const payload = {
      id: msg.id,
      conversationId,
      senderId: userId,
      content: msg.content,
      createdAt: msg.createdAt,
      sender: toUser(msg.sender),
    };

    // Realtime fan-out to every member (sender included, so their other
    // devices stay in sync).
    emitGroupMessage(memberIds, payload);

    // Offline fallback: a NEW_MESSAGE notification for every OTHER member.
    const handle = msg.sender.displayName ?? msg.sender.username ?? 'Someone';
    const title = conv.title ?? handle;
    for (const memberId of memberIds) {
      if (memberId === userId) continue;
      void notificationsService.create({
        userId: memberId,
        type: 'NEW_MESSAGE',
        title,
        body: `${handle}: ${input.content.slice(0, 140)}`,
        data: { conversationId, senderId: userId, conversation: 'group' },
      });
    }

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

  async addMembers(userId: string, conversationId: string, input: AddGroupMembersInput) {
    const conv = await this.requireMembership(userId, conversationId);
    const existingIds = new Set(conv.members.map(m => m.userId));
    const toAdd = uniq(input.userIds).filter(id => !existingIds.has(id));
    if (toAdd.length > 0) {
      const found = await prisma.user.findMany({
        where: { id: { in: toAdd }, deletedAt: null },
        select: { id: true },
      });
      const validIds = found.map(u => u.id);
      if (validIds.length > 0) {
        await prisma.conversationMember.createMany({
          data: validIds.map(id => ({ conversationId, userId: id })),
          skipDuplicates: true,
        });
      }
    }
    return this.detail(userId, conversationId);
  },

  async rename(userId: string, conversationId: string, input: RenameGroupInput) {
    // Any member can rename the thread (Clubhouse-style group chats).
    await this.requireMembership(userId, conversationId);
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { title: input.title },
    });
    return this.detail(userId, conversationId);
  },

  async removeMember(userId: string, conversationId: string, targetId: string) {
    const conv = await this.requireMembership(userId, conversationId);
    // Only the owner can remove others; removing yourself goes through leave()
    // so the empty-group cleanup runs.
    if (conv.ownerId !== userId) throw new AppError('GROUP_004');
    if (targetId === userId) throw new AppError('GROUP_005');
    await prisma.conversationMember.deleteMany({
      where: { conversationId, userId: targetId },
    });
    return this.detail(userId, conversationId);
  },

  async leave(userId: string, conversationId: string) {
    await this.requireMembership(userId, conversationId);
    await prisma.conversationMember.deleteMany({ where: { conversationId, userId } });
    // Garbage-collect an empty conversation (cascade removes its messages).
    const remaining = await prisma.conversationMember.count({ where: { conversationId } });
    if (remaining === 0) {
      await prisma.conversation.delete({ where: { id: conversationId } });
    }
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
    lastMessage: { id: string; senderId: string; content: string; createdAt: Date } | null,
    unreadCount: number,
  ) {
    return {
      id: conv.id,
      title: conv.title,
      ownerId: conv.ownerId,
      members: conv.members.map(m => toUser(m.user)),
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            senderId: lastMessage.senderId,
            content: lastMessage.content,
            createdAt: lastMessage.createdAt,
          }
        : null,
      unreadCount,
      updatedAt: conv.updatedAt,
    };
  },
};
