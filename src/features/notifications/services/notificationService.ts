import { apiClient } from '../../../shared/services/api/apiClient';
import type { AppNotification, NotificationKind } from '../../../shared/types/domain';

interface Envelope<T> {
  success: true;
  data: T;
}

type BackendType =
  | 'ROOM_INVITE'
  | 'NEW_FOLLOWER'
  | 'ROOM_STARTED'
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
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

const typeToKind: Record<BackendType, NotificationKind> = {
  NEW_FOLLOWER: 'follow',
  ROOM_INVITE: 'room_invite',
  ROOM_STARTED: 'room_starting',
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
  // event (followerId / inviterId / hostId). The frontend UI only
  // needs something non-empty in `actor.id`; display info is carried
  // by `message` (= body).
  const actorId =
    asString((data as Record<string, unknown>).followerId) ??
    asString((data as Record<string, unknown>).inviterId) ??
    asString((data as Record<string, unknown>).hostId) ??
    '';
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
    roomId: asString((data as Record<string, unknown>).roomId) ?? null,
    houseId: asString((data as Record<string, unknown>).clubId) ?? null,
    createdAt: raw.createdAt,
    isRead: raw.isRead,
  };
};

export const notificationService = {
  async list(filter: NotificationFilter = 'all'): Promise<AppNotification[]> {
    const res = await apiClient.get<Envelope<RawNotification[]>>('/notifications', {
      params: filter === 'all' ? undefined : { filter },
    });
    return res.data.data.map(toAppNotification);
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
