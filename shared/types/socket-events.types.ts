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
  ROOM_YOU_WERE_KICKED: 'room:you_were_kicked',
  ROOM_META_UPDATED: 'room:meta_updated',
  ROOM_REACTION: 'room:reaction',
  ROOM_CHAT_MESSAGE: 'room:chat_message',
  ROOM_ENDED: 'room:ended',

  // Notifications
  NOTIFICATION_NEW: 'notification:new',
  NOTIFICATION_COUNT: 'notification:count',
  USER_FOLLOWER_COUNT: 'user:follower_count',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/** Payload for `room:user_kicked` — broadcast to the whole room channel. */
export interface RoomUserKickedPayload {
  roomId: string;
  /** Id of the user who was removed. */
  userId: string;
  /** Id of the moderator/host who performed the kick. */
  kickedBy: string;
  /**
   * Human-facing display name of the kicker (`displayName ?? username`), or
   * null when it can't be resolved. Lets the client show *who* removed the user.
   */
  kickedByName?: string | null;
}

/**
 * Payload for `room:you_were_kicked` — sent to the kicked user's personal
 * channel right before their socket is evicted from the room channel. There is
 * no `userId` here because it's implicitly the channel owner (the kicked user).
 */
export interface RoomYouWereKickedPayload {
  roomId: string;
  kickedBy: string;
  kickedByName?: string | null;
}

/** Payload for `room:ended` — broadcast to the room channel when a room closes. */
export interface RoomEndedPayload {
  roomId: string;
  /** Id of the host who closed the room; omitted for an automatic (empty-room) close. */
  endedBy?: string;
  /**
   * Human-facing display name of the closer (`displayName ?? username`).
   * Omitted/null for an automatic close, where there is no actor to name.
   */
  endedByName?: string | null;
}
