import { apiClient } from '../../../shared/services/api/apiClient';
import { useAuthStore } from '../../auth/store/authStore';
import type { Envelope } from '../../../shared/types/api';
import type { Conversation, Message, UserSummary } from '../../../shared/types/domain';
import type { ContentReportReason, ContentReportResult } from '../../../shared/types/moderation';

/**
 * DM service — one "conversation" == one peer user. The frontend uses
 * `conversationId` as the peer's user id, which keeps the existing
 * hooks' call-shape intact while collapsing the two concepts.
 *
 * Backend contract (see backend/src/modules/chat) :
 *  GET    /chat/conversations?limit&cursor
 *                                            → { data: RawConversation[], nextCursor, hasMore }
 *  GET    /chat/unread-count             → { count }
 *  GET    /chat/:peerId?limit&before&paginated=true
 *                                            → { data: RawMessage[], nextCursor, hasMore }
 *  POST   /chat/:peerId                  → RawMessage
 *  PATCH  /chat/:peerId/read             → { updated }
 *  PATCH  /chat/messages/:msgId/read     → RawMessage
 *  DELETE /chat/messages/:msgId          → { deleted }
 *
 * Business rule: the recipient's privacy setting, follow graph and block state
 * decide whether a DM is allowed. The backend returns CHAT_004 otherwise; the
 * send mutation surfaces that error to the UI.
 */

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
  // Nullable now that a message can be a voice note (kind === 'VOICE').
  content: string | null;
  kind?: 'TEXT' | 'VOICE';
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  isRead: boolean;
  createdAt: string;
  sender?: RawUser;
}

interface RawConversation {
  peer: RawUser;
  lastMessage: RawMessage;
  unreadCount: number;
}

interface RawPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ConversationPage {
  items: Conversation[];
  nextCursor: string | null;
}

export interface MessagePage {
  items: Message[];
  nextCursor: string | null;
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
  text: raw.content ?? '',
  kind: raw.kind === 'VOICE' ? 'voice' : 'text',
  audioUrl: raw.audioUrl ?? null,
  durationMs: raw.audioDurationMs ?? null,
  sentAt: raw.createdAt,
  isMine: raw.senderId === viewerId,
  isRead: raw.isRead,
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
  async conversations(cursor?: string, limit = 50): Promise<ConversationPage> {
    const res = await apiClient.get<Envelope<RawPage<RawConversation>>>('/chat/conversations', {
      params: { limit, ...(cursor ? { cursor } : {}) },
    });
    const me = currentUserId();
    return {
      items: res.data.data.data.map(c => toConversation(c, me)),
      nextCursor: res.data.data.nextCursor,
    };
  },

  async conversation(
    peerId: string,
    // Optional accessor onto an already-fetched conversations list (e.g. the
    // React Query cache). When it yields a hit we skip the network call
    // entirely. Optional to keep the call-shape backward compatible.
    getCachedConversations?: () => readonly Conversation[] | undefined,
  ): Promise<Conversation> {
    const cached = getCachedConversations?.()?.find(c => c.id === peerId);
    if (cached) return cached;

    // Dedicated single-conversation endpoint: one round-trip, no O(all
    // conversations) list scan. `lastMessage` is null when there's no history.
    const res = await apiClient.get<
      Envelope<{ peer: RawUser; lastMessage: RawMessage | null; unreadCount: number }>
    >(`/chat/conversations/${peerId}`);
    const me = currentUserId();
    const { peer, lastMessage, unreadCount } = res.data.data;
    return {
      id: peer.id,
      participants: [toSummary(peer)],
      lastMessage: lastMessage ? toMessage(lastMessage, me, peer.id) : null,
      unreadCount,
      updatedAt: lastMessage ? lastMessage.createdAt : new Date().toISOString(),
    };
  },

  /**
   * One page of the thread, newest page first. `before` is the opaque
   * `nextCursor` from the previous envelope; each returned page is sorted
   * ascending for display.
   */
  async messages(
    peerId: string,
    opts: { before?: string; limit?: number } = {},
  ): Promise<MessagePage> {
    const params: Record<string, string | number | boolean> = { paginated: true };
    if (opts.before) params.before = opts.before;
    if (opts.limit) params.limit = opts.limit;
    const res = await apiClient.get<Envelope<RawPage<RawMessage>>>(`/chat/${peerId}`, { params });
    const me = currentUserId();
    return {
      items: res.data.data.data.map(m => toMessage(m, me, peerId)),
      nextCursor: res.data.data.nextCursor,
    };
  },

  async send(peerId: string, text: string, idempotencyKey: string): Promise<Message> {
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error('Message cannot be empty');
    const res = await apiClient.post<Envelope<RawMessage>>(
      `/chat/${peerId}`,
      { content: trimmed },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return toMessage(res.data.data, currentUserId(), peerId);
  },

  /**
   * Send a voice note. The clip must already be uploaded (see voiceService);
   * we post the stored URL + clip length. DM privacy is still enforced
   * server-side (403 CHAT_004), surfaced to the caller verbatim.
   */
  async sendVoice(
    peerId: string,
    audioUrl: string,
    durationMs: number,
    idempotencyKey: string,
  ): Promise<Message> {
    const res = await apiClient.post<Envelope<RawMessage>>(
      `/chat/${peerId}/voice`,
      { audioUrl, durationMs },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
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

  async report(messageId: string, reason: ContentReportReason): Promise<ContentReportResult> {
    const res = await apiClient.post<Envelope<ContentReportResult>>(
      `/chat/messages/${messageId}/report`,
      { reason },
    );
    return res.data.data;
  },
};
