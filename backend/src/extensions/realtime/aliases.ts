import type { Server } from 'socket.io';
import { logger } from '../../config/logger';

/**
 * Socket alias emitter (parité noms d'événements Clubhouse).
 *
 * Le code legacy émet des events sous des noms scoped (`hallway:room_*`,
 * `room:hand_raised`, etc.). La spec Clubhouse utilise des noms plats
 * (`room_title_updated`, `mute_all_speakers`, `room_closed`, ...). Cette
 * couche émet **les deux** afin qu'un client codant contre la spec stricte
 * et un client codant contre les noms legacy fonctionnent en parallèle.
 *
 * Approche : lazy reference au Server socket.io exposé par
 * `setRealtimeServer` dans le code legacy. Aucune modif de
 * `backend/src/socket/realtime.ts`.
 */

let ioRef: Server | null = null;

/**
 * Doit être appelé une fois par le serveur étendu juste après
 * `createSocketServer()`. Le serveur étendu importe et appelle
 * `setRealtimeAliasServer(io)` (cf. `extensions/server.ts`).
 */
export const setRealtimeAliasServer = (io: Server): void => {
  ioRef = io;
};

const roomChannel = (roomId: string) => `room:${roomId}`;
const userChannel = (userId: string) => `user:${userId}`;
const HALLWAY = 'hallway';

/**
 * Helper : émet en simultané sur l'event legacy ET sur l'alias plat.
 * Si l'event legacy n'existe pas (cas pur extension), on n'émet que
 * l'alias.
 */
const emitBoth = (
  channel: string,
  legacyName: string | null,
  aliasName: string,
  payload: unknown,
): void => {
  if (!ioRef) {
    logger.debug('aliases: io not yet bound, skipping', { aliasName });
    return;
  }
  const room = ioRef.to(channel);
  if (legacyName) room.emit(legacyName, payload);
  room.emit(aliasName, payload);
};

// ─── Room lifecycle ──────────────────────────────────────────────
export const emitRoomTitleUpdated = (
  roomId: string,
  payload: { roomId: string; title: string },
): void => emitBoth(roomChannel(roomId), 'room:meta_updated', 'room_title_updated', payload);

export const emitRoomClosed = (
  roomId: string,
  payload: { roomId: string; reason?: string },
): void => {
  emitBoth(roomChannel(roomId), null, 'room_closed', payload);
  ioRef?.to(HALLWAY).emit('hallway:room_closed', { roomId });
};

export const emitRoomParticipantJoined = (
  roomId: string,
  user: { id: string; username: string | null; displayName: string | null },
): void => emitBoth(roomChannel(roomId), null, 'room_participant_joined', { roomId, user });

export const emitRoomParticipantLeft = (roomId: string, userId: string): void =>
  emitBoth(roomChannel(roomId), null, 'room_participant_left', { roomId, userId });

export const emitParticipantsUpdate = (roomId: string, count: number): void =>
  emitBoth(roomChannel(roomId), null, 'participants_update', { roomId, count });

// ─── Moderation ───────────────────────────────────────────────────
export const emitRolePromotedToModerator = (roomId: string, userId: string): void =>
  emitBoth(roomChannel(roomId), 'room:role_changed', 'role_promoted_to_moderator', {
    roomId,
    userId,
    role: 'MODERATOR',
  });

export const emitMuteAllSpeakers = (roomId: string, by: string): void =>
  emitBoth(roomChannel(roomId), null, 'mute_all_speakers', { roomId, by });

export const emitSpeakerMovedToAudience = (roomId: string, userId: string): void =>
  emitBoth(roomChannel(roomId), 'room:role_changed', 'speaker_moved_to_audience', {
    roomId,
    userId,
    role: 'LISTENER',
  });

export const emitSpeakInviteSent = (
  toUserId: string,
  payload: { roomId: string; fromUserId: string },
): void => emitBoth(userChannel(toUserId), null, 'speak_invite_sent', payload);

export const emitSpeakInviteResponse = (
  roomId: string,
  payload: { roomId: string; userId: string; accepted: boolean },
): void => emitBoth(roomChannel(roomId), null, 'speak_invite_response', payload);

// ─── Audio (signaling/health) ─────────────────────────────────────
export const emitNetworkQuality = (
  userId: string,
  payload: { roomId: string; bars: 1 | 2 | 3; warning: string | null },
): void => emitBoth(userChannel(userId), null, 'network_quality', payload);

export const emitAudioReconnecting = (userId: string, roomId: string): void =>
  emitBoth(userChannel(userId), null, 'audio_reconnecting', { roomId });

export const emitAudioReconnected = (userId: string, roomId: string): void =>
  emitBoth(userChannel(userId), null, 'audio_reconnected', { roomId });

// ─── Social ───────────────────────────────────────────────────────
export const emitRoomStartedByFollowing = (
  followerUserId: string,
  payload: {
    roomId: string;
    hostId: string;
    hostName: string | null;
    title: string;
  },
): void => emitBoth(userChannel(followerUserId), null, 'room_started_by_following', payload);

/**
 * Ephemeral "someone you follow just joined a room" realtime ping.
 *
 * Emitted on the joiner's followers' personal user-channels when the
 * joiner enters a room (see rooms.service.join). Intentionally NOT a
 * persisted Prisma notification — there is no NotificationType for it and
 * the Prisma client can't be regenerated, so this stays purely realtime
 * (best-effort, fire-and-forget). Clients that don't listen simply miss it.
 */
export const emitRoomJoinedByFollowing = (
  followerUserId: string,
  payload: {
    roomId: string;
    userId: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  },
): void => emitBoth(userChannel(followerUserId), null, 'room_joined_by_following', payload);

export const emitPingUser = (
  toUserId: string,
  payload: { fromUserId: string; roomId: string; type: 'ping' | 'wave' },
): void => emitBoth(userChannel(toUserId), null, 'ping_user', payload);

export const emitJoinRequest = (
  adminUserId: string,
  payload: { clubId: string; requesterId: string; message: string | null },
): void => emitBoth(userChannel(adminUserId), null, 'join_request', payload);

export const emitJoinRequestResponse = (
  requesterId: string,
  payload: { clubId: string; approved: boolean },
): void => emitBoth(userChannel(requesterId), null, 'join_request_response', payload);

// ─── Chat ─────────────────────────────────────────────────────────
export const emitChatDisabled = (roomId: string, by: string): void =>
  emitBoth(roomChannel(roomId), null, 'chat_disabled', { roomId, by });

export const emitChatEnabled = (roomId: string, by: string): void =>
  emitBoth(roomChannel(roomId), null, 'chat_enabled', { roomId, by });
