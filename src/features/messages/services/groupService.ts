import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { UserSummary } from '../../../shared/types/domain';

/**
 * Group DM (Backchannel groups) service. Separate from the 1:1 messageService
 * because groups have their own backend tables (Conversation / GroupMessage).
 * Backend contract — backend/src/modules/groups:
 *   GET   /groups                 → GroupConversation[]
 *   POST  /groups                 → GroupConversation   { title?, memberIds[] }
 *   GET   /groups/:id             → GroupConversation
 *   GET   /groups/:id/messages    → GroupMessage[]
 *   POST  /groups/:id/messages    → GroupMessage        { content }
 *   PATCH /groups/:id/read        → { read: true }
 */

interface RawUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface RawGroupMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender?: RawUser;
}

interface RawGroupConversation {
  id: string;
  title: string | null;
  ownerId: string;
  members: RawUser[];
  lastMessage: { id: string; senderId: string; content: string; createdAt: string } | null;
  unreadCount: number;
  updatedAt: string;
}

export interface GroupMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: UserSummary | null;
}

export interface GroupConversation {
  id: string;
  title: string | null;
  ownerId: string;
  members: UserSummary[];
  lastMessage: { id: string; senderId: string; content: string; createdAt: string } | null;
  unreadCount: number;
  updatedAt: string;
}

const toSummary = (u: RawUser): UserSummary => ({
  id: u.id,
  username: u.username ?? '',
  displayName: u.displayName ?? u.username ?? '',
  avatarUrl: u.avatarUrl,
});

const toMessage = (m: RawGroupMessage): GroupMessage => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  content: m.content,
  createdAt: m.createdAt,
  sender: m.sender ? toSummary(m.sender) : null,
});

const toConversation = (c: RawGroupConversation): GroupConversation => ({
  id: c.id,
  title: c.title,
  ownerId: c.ownerId,
  members: c.members.map(toSummary),
  lastMessage: c.lastMessage,
  unreadCount: c.unreadCount,
  updatedAt: c.updatedAt,
});

export const groupService = {
  async list(): Promise<GroupConversation[]> {
    const res = await apiClient.get<Envelope<RawGroupConversation[]>>('/groups');
    return res.data.data.map(toConversation);
  },

  async detail(id: string): Promise<GroupConversation> {
    const res = await apiClient.get<Envelope<RawGroupConversation>>(`/groups/${id}`);
    return toConversation(res.data.data);
  },

  async messages(id: string): Promise<GroupMessage[]> {
    const res = await apiClient.get<Envelope<RawGroupMessage[]>>(`/groups/${id}/messages`);
    return res.data.data.map(toMessage);
  },

  async send(id: string, content: string): Promise<GroupMessage> {
    const trimmed = content.trim();
    if (trimmed.length === 0) throw new Error('Message cannot be empty');
    const res = await apiClient.post<Envelope<RawGroupMessage>>(`/groups/${id}/messages`, {
      content: trimmed,
    });
    return toMessage(res.data.data);
  },

  async create(memberIds: string[], title?: string): Promise<GroupConversation> {
    const res = await apiClient.post<Envelope<RawGroupConversation>>('/groups', {
      memberIds,
      ...(title && title.trim() ? { title: title.trim() } : {}),
    });
    return toConversation(res.data.data);
  },

  async markAsRead(id: string): Promise<{ read: true }> {
    await apiClient.patch(`/groups/${id}/read`);
    return { read: true };
  },
};
