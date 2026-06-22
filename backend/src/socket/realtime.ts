import type { Server } from 'socket.io';
import { HALLWAY_ROOM } from './handlers/hallway.handler';
import { MAPS_CHANNEL, roomChannel, userChannel } from './channels';

/**
 * Side-channel the HTTP layer uses to fan events into the socket tier.
 * Keeping the Server reference behind a setter avoids a circular import
 * between socket.server → rooms.service → socket.server. The server
 * sets itself once it's ready; anything that fires before boot is a
 * no-op (tests creating rooms before Socket.IO is up, etc.).
 */

let ioRef: Server | null = null;

export const setRealtimeServer = (io: Server): void => {
  ioRef = io;
};

interface RoomCreatedPayload {
  id: string;
  title: string;
  hostId: string;
  clubId: string | null;
  isLive: boolean;
  scheduledFor: string | null;
  createdAt: string;
}

export const emitHallwayRoomCreated = (payload: RoomCreatedPayload): void => {
  ioRef?.to(HALLWAY_ROOM).emit('hallway:room_created', payload);
};

export const emitHallwayRoomClosed = (roomId: string): void => {
  ioRef?.to(HALLWAY_ROOM).emit('hallway:room_closed', { roomId });
};

/**
 * Tells everyone still in a room that it has ended, so non-host participants
 * leave the screen. The socket `room:end` handler already emits this; the REST
 * end() path must emit it too (its clients never send the socket event).
 *
 * `endedBy`/`endedByName` identify the host who closed the room so clients can
 * show *who* ended it. They're omitted for an automatic (empty-room) close,
 * where there is no actor.
 */
export const emitRoomEnded = (
  roomId: string,
  payload: { endedBy?: string; endedByName?: string | null } = {},
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:ended', { roomId, ...payload });
};

/**
 * Broadcast that a host/mod flipped live-captions for the room, so every
 * client subscribes/unsubscribes the caption stream live instead of only
 * picking it up on next mount.
 */
export const emitRoomCaptionsState = (roomId: string, enabled: boolean): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:captions_state', { roomId, enabled });
};

export const emitHallwayRoomUpdated = (
  roomId: string,
  partial: { participantCount?: number; title?: string },
): void => {
  ioRef?.to(HALLWAY_ROOM).emit('hallway:room_updated', { roomId, ...partial });
};

// ─── Per-room events ─────────────────────────────────────
// Targets the `room:<id>` group that room.handler auto-joins on connect
// for every participant. Callers pass pre-serialised payloads (ISO dates,
// no Prisma Date objects) so the socket side stays transport-pure.

export const emitRoomHandRaised = (
  roomId: string,
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:hand_raised', { roomId, user });
};

export const emitRoomHandLowered = (roomId: string, userId: string): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:hand_lowered', { roomId, userId });
};

export const emitRoomMessage = (
  roomId: string,
  message: {
    id: string;
    content: string;
    createdAt: string;
    user: {
      id: string;
      username: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    };
    replyTo?: {
      id: string;
      content: string;
      user: {
        id: string;
        username: string | null;
        displayName: string | null;
        avatarUrl: string | null;
      };
    } | null;
  },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:chat_message', { roomId, ...message });
};

export const emitRoomReaction = (
  roomId: string,
  payload: { userId: string; emoji: string; createdAt: string },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:reaction', { roomId, ...payload });
};

export const emitRoomRoleChanged = (
  roomId: string,
  payload: { userId: string; role: string },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:role_changed', { roomId, ...payload });
};

export const emitRoomUserKicked = (
  roomId: string,
  payload: { userId: string; kickedBy: string; kickedByName?: string | null },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:user_kicked', { roomId, ...payload });
};

/**
 * Server-side half of a kick: forcibly evict a user's socket(s) from the
 * `room:<id>` channel. `emitRoomUserKicked` only *notifies* the room — a
 * client that ignores the event would otherwise stay subscribed and keep
 * receiving every room broadcast (chat, reactions, role/meta changes). This
 * removes them authoritatively via `socketsLeave`, which works cluster-wide
 * through the Redis adapter (it reaches the target's sockets on any node, not
 * just this one). A dedicated `room:you_were_kicked` is pushed to the user's
 * personal channel first so their client still gets a direct signal even
 * though it's about to leave the room channel. No-op before socket boot.
 *
 * `kickedByName` is the moderator's human-facing display name, carried so the
 * kicked user's client can show *who* removed them.
 */
export const forceLeaveRoom = (
  roomId: string,
  userId: string,
  kickedBy: string,
  kickedByName?: string | null,
): void => {
  // Personal channel is independent of the room channel, so this lands
  // regardless of the eviction below.
  ioRef?.to(userChannel(userId)).emit('room:you_were_kicked', { roomId, kickedBy, kickedByName });
  ioRef?.in(userChannel(userId)).socketsLeave(roomChannel(roomId));
};

export const emitRoomMuteChanged = (
  roomId: string,
  payload: { userId: string; isMuted: boolean },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:mute-changed', { roomId, ...payload });
};

export const emitUserFollowerCount = (userId: string, count: number): void => {
  ioRef?.to(userChannel(userId)).emit('user:follower_count', { userId, count });
};

// ─── Maps presence — live mic/room-audio state ───────────────────────────
/**
 * Fan a user's live mic/room-audio state out to everyone watching the map
 * (`map:user_update`). Bridges the room tier (mute toggles, join/leave) into
 * the maps tier so a follower's avatar marker flips between speaking / muted /
 * listener / online badges in real time. Carries only the changed flags — no
 * coordinates, which still stream via `maps:user-moved` — so the client merges
 * it as a surgical per-user patch. No-op before socket boot.
 */
export const emitMapUserUpdate = (payload: {
  userId: string;
  isSpeaking?: boolean;
  isMuted?: boolean;
  isListener?: boolean;
  isInRoom?: boolean;
}): void => {
  ioRef?.to(MAPS_CHANNEL).emit('map:user_update', payload);
};

export const emitRoomMetaUpdated = (
  roomId: string,
  patch: {
    title?: string;
    chatEnabled?: boolean;
    chatVisibility?: 'ALL' | 'MODS_ONLY';
    isLocked?: boolean;
    isPrivate?: boolean;
  },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:meta_updated', { roomId, ...patch });
};

// #32: presence toggle. Going invisible looks like a leave to others; becoming
// visible looks like a join — both make peers refetch the (server-filtered)
// participant list. Same payload shape as the socket join/leave broadcasts.
export const emitRoomUserJoined = (roomId: string, userId: string): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:user-joined', { userId, roomId });
};
export const emitRoomUserLeft = (roomId: string, userId: string): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:user-left', { userId, roomId });
};

// ─── Per-user notification events ────────────────────────
// Fires on the user's personal channel so they get live notification
// badge updates without polling.

export const emitNotification = (
  userId: string,
  payload: {
    id: string;
    type: string;
    title: string;
    body: string;
    data?: unknown;
    createdAt: string;
  },
): void => {
  ioRef?.to(userChannel(userId)).emit('notification:new', payload);
};

export const emitNotificationCount = (userId: string, count: number): void => {
  ioRef?.to(userChannel(userId)).emit('notification:count', { count });
};

/**
 * Pushes a freshly-created DM to both parties' personal channels so the
 * recipient's client updates in realtime. The REST send path (chat.service)
 * must call this — its clients never emit the `chat:send` socket event, so
 * without it the recipient sees nothing until a manual refetch.
 */
export const emitChatMessage = (senderId: string, receiverId: string, msg: unknown): void => {
  ioRef?.to(userChannel(senderId)).emit('chat:message', msg);
  ioRef?.to(userChannel(receiverId)).emit('chat:message', msg);
};

/**
 * Fan a new group message out to every member's personal channel so their
 * conversation list / open thread updates live. Group conversations have no
 * dedicated socket room, so we target each member's `user:<id>` channel (the
 * same one chat + notifications already use).
 */
export const emitGroupMessage = (memberIds: readonly string[], payload: unknown): void => {
  for (const id of memberIds) {
    ioRef?.to(userChannel(id)).emit('group:message', payload);
  }
};
