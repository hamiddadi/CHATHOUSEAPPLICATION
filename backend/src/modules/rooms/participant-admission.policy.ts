export interface ReconnectAdmissionState {
  room: { isLive: boolean; endedAt: Date | null } | null;
  user: {
    currentRoomId: string | null;
    deletedAt: Date | null;
    suspendedUntil: Date | null;
  } | null;
  participant: {
    id: string;
    leftAt: Date | null;
    admissionConfirmedAt: Date | null;
  } | null;
}

/**
 * A transport drop may extend only a lease that was already committed by the
 * Socket.IO admission handshake. In particular, seeing a disconnect for an
 * old socket must never turn a concurrent REST/null admission into a confirmed
 * one or resurrect presence revoked by leave, room closure, or moderation.
 */
export const canRefreshReconnectAdmission = (
  roomId: string,
  state: ReconnectAdmissionState,
  now: Date,
): state is ReconnectAdmissionState & {
  room: NonNullable<ReconnectAdmissionState['room']>;
  user: NonNullable<ReconnectAdmissionState['user']>;
  participant: NonNullable<ReconnectAdmissionState['participant']> & {
    admissionConfirmedAt: Date;
  };
} =>
  state.room !== null &&
  state.room.isLive &&
  state.room.endedAt === null &&
  state.user !== null &&
  state.user.currentRoomId === roomId &&
  state.user.deletedAt === null &&
  (state.user.suspendedUntil === null || state.user.suspendedUntil <= now) &&
  state.participant !== null &&
  state.participant.leftAt === null &&
  state.participant.admissionConfirmedAt !== null;
