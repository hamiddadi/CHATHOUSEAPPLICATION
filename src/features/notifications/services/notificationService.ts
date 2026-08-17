import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { AppNotification, NotificationKind } from '../../../shared/types/domain';

type BackendType =
  | 'ROOM_INVITE'
  | 'NEW_FOLLOWER'
  | 'FOLLOW_REQUEST'
  | 'ROOM_STARTED'
  | 'ROOM_CANCELED'
  | 'ROOM_ENDED_BY_ADMIN'
  | 'SPEAKER_REQUEST'
  | 'MENTION'
  | 'CLUB_INVITE'
  | 'WAVE'
  | 'HAND_ACCEPTED'
  | 'RSVP_REMINDER'
  | 'NEW_MESSAGE';

export type NotificationFilter = 'all' | 'rooms' | 'social' | 'clubs';

interface RawNotification {
  id: string;
  userId: string;
  type: BackendType;
  actorId?: string | null;
  targetId?: string | null;
  targetType?: string | null;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  nextCursor: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

const typeToKind: Record<BackendType, NotificationKind> = {
  NEW_FOLLOWER: 'follow',
  FOLLOW_REQUEST: 'follow_request',
  ROOM_INVITE: 'room_invite',
  ROOM_STARTED: 'room_starting',
  ROOM_CANCELED: 'room_canceled',
  ROOM_ENDED_BY_ADMIN: 'room_ended_by_admin',
  SPEAKER_REQUEST: 'mention',
  MENTION: 'mention',
  // Frontend domain calls a club a "house".
  CLUB_INVITE: 'house_invite',
  WAVE: 'wave',
  HAND_ACCEPTED: 'hand_accepted',
  RSVP_REMINDER: 'rsvp_reminder',
  NEW_MESSAGE: 'new_message',
};

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const toAppNotification = (raw: RawNotification): AppNotification => {
  const data = raw.data ?? {};
  // Server stores the actor id under different keys depending on the
  // event (followerId / inviterId / hostId / waverId / senderId). The
  // frontend UI only needs something non-empty in `actor.id` so the tap
  // deep-link fires; display info is carried by `message` (= body).
  const d = data as Record<string, unknown>;
  const actorId =
    asString(raw.actorId) ??
    asString(d.followerId) ??
    asString(d.inviterId) ??
    asString(d.hostId) ??
    asString(d.waverId) ??
    asString(d.senderId) ??
    asString(d.actorId) ??
    (raw.targetType === 'user' ? asString(raw.targetId) : undefined) ??
    '';
  const roomId =
    asString(d.roomId) ?? (raw.targetType === 'room' ? asString(raw.targetId) : undefined) ?? null;
  const houseId =
    asString(d.clubId) ??
    asString(d.houseId) ??
    (raw.targetType === 'club' || raw.targetType === 'house'
      ? (asString(raw.targetId) ?? null)
      : null);
  const conversationType =
    d.conversation === 'group' ? 'group' : d.conversation === 'dm' ? 'dm' : null;
  return {
    id: raw.id,
    kind: typeToKind[raw.type],
    actor: {
      id: actorId,
      username: '',
      displayName: raw.title,
      avatarUrl: null,
    },
    message: raw.body,
    roomId,
    houseId,
    conversationId: asString(d.conversationId) ?? null,
    conversationType,
    createdAt: raw.createdAt,
    isRead: raw.isRead,
  };
};

export const notificationService = {
  async list(filter: NotificationFilter = 'all', cursor?: string): Promise<NotificationPage> {
    const res = await apiClient.get<unknown>('/notifications', {
      params: {
        ...(filter !== 'all' ? { filter } : {}),
        ...(cursor ? { cursor } : {}),
      },
    });

    // Current API: { success, data: RawNotification[], nextCursor, hasMore }.
    // Also accept the previous array-only envelope and the briefly-used nested
    // page shape so mobile/backend rolling deployments remain interoperable.
    const responseBody = res.data;
    const root =
      responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
        ? (responseBody as Record<string, unknown>)
        : null;
    const payload = root ? root.data : responseBody;
    const nested =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const rows = (
      Array.isArray(payload)
        ? payload
        : Array.isArray(nested?.data)
          ? nested.data
          : Array.isArray(nested?.items)
            ? nested.items
            : []
    ) as RawNotification[];

    const rawHasMore = root?.hasMore ?? nested?.hasMore;
    const hasMore = typeof rawHasMore === 'boolean' ? rawHasMore : rows.length >= PAGE_SIZE;
    const rawNextCursor = root?.nextCursor ?? nested?.nextCursor;
    const legacyCursor = hasMore ? (rows[rows.length - 1]?.createdAt ?? null) : null;
    const nextCursor =
      typeof rawNextCursor === 'string'
        ? rawNextCursor
        : rawNextCursor === null
          ? null
          : legacyCursor;

    return { items: rows.map(toAppNotification), nextCursor, hasMore };
  },

  async unreadCount(): Promise<number> {
    const res = await apiClient.get<Envelope<{ count: number }>>('/notifications/unread-count');
    return res.data.data.count;
  },

  async markAsRead(notificationId: string): Promise<{ read: true }> {
    const res = await apiClient.patch<Envelope<{ read: true }>>(
      `/notifications/${notificationId}/read`,
    );
    return res.data.data;
  },

  async markAllAsRead(): Promise<{ read: number }> {
    const res = await apiClient.patch<Envelope<{ updated: number }>>('/notifications/read-all');
    return { read: res.data.data.updated };
  },

  async remove(notificationId: string): Promise<{ deleted: true }> {
    const res = await apiClient.delete<Envelope<{ deleted: true }>>(
      `/notifications/${notificationId}`,
    );
    return res.data.data;
  },
};
