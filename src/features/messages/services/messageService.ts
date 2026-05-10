import { apiClient } from '../../../shared/services/api/apiClient';
import { useAuthStore } from '../../auth/store/authStore';
import type { Conversation, Message, UserSummary } from '../../../shared/types/domain';

/**
 * DM service — one "conversation" == one peer user. The frontend uses
 * `conversationId` as the peer's user id, which keeps the existing
 * hooks' call-shape intact while collapsing the two concepts.
 *
 * Backend contract (see backend/src/modules/chat) :
 *  GET    /chat/conversations            → [{ peer, lastMessage, unreadCount }]
 *  GET    /chat/unread-count             → { count }
 *  GET    /chat/:peerId?limit&before     → [RawMessage]
 *  POST   /chat/:peerId                  → RawMessage
 *  PATCH  /chat/:peerId/read             → { updated }
 *  PATCH  /chat/messages/:msgId/read     → RawMessage
 *  DELETE /chat/messages/:msgId          → { deleted }
 *
 * Business rule: DM is only allowed when the two users follow each
 * other. The backend returns 403 CHAT_004 otherwise; the send mutation
 * surfaces that error verbatim to the UI.
 */

interface Envelope<T> {
  success: true;
  data: T;
}

interface RawUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface RawMessage {
  id: string;
  senderId: string;
  receiverId: string | null;
  content: string;
  isRead: boolean;
  createdAt: string;
  sender?: RawUser;
}

interface RawConversation {
  peer: RawUser;
  lastMessage: RawMessage;
  unreadCount: number;
}

const toSummary = (u: RawUser): UserSummary => ({
  id: u.id,
  username: u.username ?? '',
  displayName: u.displayName ?? u.username ?? '',
  avatarUrl: u.avatarUrl,
});

const currentUserId = (): string => useAuthStore.getState().user?.id ?? '';

const toMessage = (raw: RawMessage, viewerId: string, peerId: string): Message => ({
  id: raw.id,
  conversationId: peerId,
  authorId: raw.senderId,
  text: raw.content,
  sentAt: raw.createdAt,
  isMine: raw.senderId === viewerId,
});

const toConversation = (raw: RawConversation, viewerId: string): Conversation => {
  const peerSummary = toSummary(raw.peer);
  return {
    id: raw.peer.id,
    participants: [peerSummary],
    lastMessage: toMessage(raw.lastMessage, viewerId, raw.peer.id),
    unreadCount: raw.unreadCount,
    updatedAt: raw.lastMessage.createdAt,
  };
};

export const messageService = {
  async conversations(): Promise<Conversation[]> {
    const res = await apiClient.get<Envelope<RawConversation[]>>('/chat/conversations');
    const me = currentUserId();
    return res.data.data.map(c => toConversation(c, me));
  },

  async conversation(peerId: string): Promise<Conversation> {
    // No dedicated endpoint; synthesise by filtering the conversations
    // list. Cheap (server returns at most 500 rows) and keeps the API
    // surface narrow. If we ever need deep metadata we can add a GET
    // /chat/conversations/:peerId on the backend.
    const list = await this.conversations();
    const hit = list.find(c => c.id === peerId);
    if (hit) return hit;

    // No history yet — fetch the peer user directly and return an empty
    // conversation skeleton so the thread header renders in one RT.
    const peerRes = await apiClient.get<Envelope<RawUser>>(`/users/${peerId}`);
    const peer = toSummary(peerRes.data.data);
    return {
      id: peerId,
      participants: [peer],
      lastMessage: null,
      unreadCount: 0,
      updatedAt: new Date().toISOString(),
    };
  },

  async messages(peerId: string): Promise<Message[]> {
    const res = await apiClient.get<Envelope<RawMessage[]>>(`/chat/${peerId}`);
    const me = currentUserId();
    return res.data.data.map(m => toMessage(m, me, peerId));
  },

  async send(peerId: string, text: string): Promise<Message> {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error('Message cannot be empty');
    const res = await apiClient.post<Envelope<RawMessage>>(`/chat/${peerId}`, {
      content: trimmed,
    });
    return toMessage(res.data.data, currentUserId(), peerId);
  },

  async markAsRead(peerId: string): Promise<{ read: true }> {
    await apiClient.patch(`/chat/${peerId}/read`);
    return { read: true };
  },

  async unreadCount(): Promise<number> {
    const res = await apiClient.get<Envelope<{ count: number }>>('/chat/unread-count');
    return res.data.data.count;
  },

  async remove(messageId: string): Promise<{ deleted: true }> {
    const res = await apiClient.delete<Envelope<{ deleted: true }>>(`/chat/messages/${messageId}`);
    return res.data.data;
  },
};
