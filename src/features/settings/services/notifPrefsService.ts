import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';

// The nine push-notification toggles exposed by the backend
// (GET/PATCH /users/me/notification-preferences). Mirrors `notifPrefsSchema`
// (users.schema) and the Prisma `NotificationPreference` model.
export interface NotifPrefs {
  newFollower: boolean;
  wave: boolean;
  roomInvite: boolean;
  clubInvite: boolean;
  roomStarted: boolean;
  eventReminder: boolean;
  newMessage: boolean;
  handAccepted: boolean;
  mention: boolean;
}

// The keys we render as switches — also the only keys PATCH accepts
// (its schema is `.strict()`).
export const NOTIF_PREF_KEYS: readonly (keyof NotifPrefs)[] = [
  'newFollower',
  'wave',
  'roomInvite',
  'clubInvite',
  'roomStarted',
  'eventReminder',
  'newMessage',
  'handAccepted',
  'mention',
];

// The PATCH endpoint accepts a partial set (every key is `.optional()`); we
// always send a single `{ [key]: value }` from the screen.
export type UpdateNotifPrefsInput = Partial<NotifPrefs>;

// The backend returns the full row (id, userId + the nine booleans). We only
// consume the booleans here, so narrow on read to the `NotifPrefs` shape.
interface RawNotifPrefs extends NotifPrefs {
  id: string;
  userId: string;
}

const mapPrefs = (raw: RawNotifPrefs): NotifPrefs => ({
  newFollower: raw.newFollower,
  wave: raw.wave,
  roomInvite: raw.roomInvite,
  clubInvite: raw.clubInvite,
  roomStarted: raw.roomStarted,
  eventReminder: raw.eventReminder,
  newMessage: raw.newMessage,
  handAccepted: raw.handAccepted,
  mention: raw.mention,
});

export const notifPrefsService = {
  async get(): Promise<NotifPrefs> {
    const res = await apiClient.get<Envelope<RawNotifPrefs>>('/users/me/notification-preferences');
    return mapPrefs(res.data.data);
  },

  async update(input: UpdateNotifPrefsInput): Promise<NotifPrefs> {
    const res = await apiClient.patch<Envelope<RawNotifPrefs>>(
      '/users/me/notification-preferences',
      input,
    );
    return mapPrefs(res.data.data);
  },
};
