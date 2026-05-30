import type { Server } from 'socket.io';
import { HALLWAY_ROOM } from './handlers/hallway.handler';
import { roomChannel, userChannel } from './channels';

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
  payload: { userId: string; kickedBy: string },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:user_kicked', { roomId, ...payload });
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

export const emitRoomMetaUpdated = (
  roomId: string,
  patch: { title?: string; chatEnabled?: boolean; chatVisibility?: 'ALL' | 'MODS_ONLY' },
): void => {
  ioRef?.to(roomChannel(roomId)).emit('room:meta_updated', { roomId, ...patch });
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
