import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { MessageKind, UserSummary } from '../../../shared/types/domain';

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
  // Nullable now that a group message can be a voice note (kind === 'VOICE').
  content: string | null;
  kind?: 'TEXT' | 'VOICE';
  audioUrl?: string | null;
  durationMs?: number | null;
  createdAt: string;
  sender?: RawUser;
}

interface RawLastMessage {
  id: string;
  senderId: string;
  content: string | null;
  kind?: 'TEXT' | 'VOICE';
  createdAt: string;
}

interface RawGroupConversation {
  id: string;
  title: string | null;
  ownerId: string;
  members: RawUser[];
  lastMessage: RawLastMessage | null;
  unreadCount: number;
  updatedAt: string;
}

export interface GroupMessage {
  id: string;
  conversationId: string;
  senderId: string;
  // Empty/null for voice notes (use audioUrl + durationMs instead).
  content: string | null;
  kind: MessageKind;
  audioUrl: string | null;
  durationMs: number | null;
  createdAt: string;
  sender: UserSummary | null;
}

export interface GroupLastMessage {
  id: string;
  senderId: string;
  content: string | null;
  kind: MessageKind;
  createdAt: string;
}

export interface GroupConversation {
  id: string;
  title: string | null;
  ownerId: string;
  members: UserSummary[];
  lastMessage: GroupLastMessage | null;
  unreadCount: number;
  updatedAt: string;
}

const toSummary = (u: RawUser): UserSummary => ({
  id: u.id,
  username: u.username ?? '',
  displayName: u.displayName ?? u.username ?? '',
  avatarUrl: u.avatarUrl,
});

const toKind = (raw?: 'TEXT' | 'VOICE'): MessageKind => (raw === 'VOICE' ? 'voice' : 'text');

const toMessage = (m: RawGroupMessage): GroupMessage => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  content: m.content,
  kind: toKind(m.kind),
  audioUrl: m.audioUrl ?? null,
  durationMs: m.durationMs ?? null,
  createdAt: m.createdAt,
  sender: m.sender ? toSummary(m.sender) : null,
});

const toLastMessage = (m: RawLastMessage | null): GroupLastMessage | null =>
  m
    ? {
        id: m.id,
        senderId: m.senderId,
        content: m.content,
        kind: toKind(m.kind),
        createdAt: m.createdAt,
      }
    : null;

const toConversation = (c: RawGroupConversation): GroupConversation => ({
  id: c.id,
  title: c.title,
  ownerId: c.ownerId,
  members: c.members.map(toSummary),
  lastMessage: toLastMessage(c.lastMessage),
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

  /**
   * Send a voice note to a group. The clip must already be uploaded (see
   * voiceService); we post the stored URL + clip length to /groups/:id/voice.
   */
  async sendVoice(id: string, audioUrl: string, durationMs: number): Promise<GroupMessage> {
    const res = await apiClient.post<Envelope<RawGroupMessage>>(`/groups/${id}/voice`, {
      audioUrl,
      durationMs,
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

  async rename(id: string, title: string): Promise<GroupConversation> {
    const res = await apiClient.patch<Envelope<RawGroupConversation>>(`/groups/${id}`, {
      title: title.trim(),
    });
    return toConversation(res.data.data);
  },

  async addMembers(id: string, userIds: string[]): Promise<GroupConversation> {
    const res = await apiClient.post<Envelope<RawGroupConversation>>(`/groups/${id}/members`, {
      userIds,
    });
    return toConversation(res.data.data);
  },

  async removeMember(id: string, userId: string): Promise<GroupConversation> {
    const res = await apiClient.delete<Envelope<RawGroupConversation>>(
      `/groups/${id}/members/${userId}`,
    );
    return toConversation(res.data.data);
  },

  async leave(id: string): Promise<{ left: true }> {
    await apiClient.post(`/groups/${id}/leave`);
    return { left: true };
  },
};
