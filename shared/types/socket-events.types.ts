/**
 * Canonical socket.io event names + payload shapes shared between
 * `backend/src/socket/realtime.ts` (emitter) and the mobile client.
 * Adoption is opt-in — currently used by the new Vague 1-7 extensions
 * documentation only.
 */

export const SOCKET_EVENTS = {
  // Hallway
  HALLWAY_ROOM_CREATED: 'hallway:room_created',
  HALLWAY_ROOM_CLOSED: 'hallway:room_closed',
  HALLWAY_ROOM_UPDATED: 'hallway:room_updated',

  // Room
  ROOM_HAND_RAISED: 'room:hand_raised',
  ROOM_HAND_LOWERED: 'room:hand_lowered',
  ROOM_ROLE_CHANGED: 'room:role_changed',
  ROOM_MUTE_CHANGED: 'room:mute_changed',
  ROOM_USER_KICKED: 'room:user_kicked',
  ROOM_META_UPDATED: 'room:meta_updated',
  ROOM_REACTION: 'room:reaction',
  ROOM_CHAT_MESSAGE: 'room:chat_message',

  // Notifications
  NOTIFICATION_NEW: 'notification:new',
  NOTIFICATION_COUNT: 'notification:count',
  USER_FOLLOWER_COUNT: 'user:follower_count',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
