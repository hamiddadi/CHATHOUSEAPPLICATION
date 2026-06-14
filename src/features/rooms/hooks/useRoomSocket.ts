import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { roomKeys } from './useRooms';

interface RoomEventPayload {
  roomId: string;
}

/**
 * Joins the per-room Socket.IO channel and forwards every server-pushed
 * mutation back to React Query so the screen rerenders without refetch
 * polling. Without this hook, the backend's `room:*` and `rtc:*` broadcasts
 * never reach the client because room.handler only joins the channel on
 * receipt of `room:join`.
 *
 * `onJoinDenied` fires when the server's `room:join` ack reports failure — i.e.
 * the join was GATED (SOCIAL follow-gate, CLOSED invite-only, RoomBan, or an
 * ended room). Previously the emit had no ack callback, so a denied join was
 * swallowed: the user stayed on the (un-gated GET) room screen with no
 * Participant row, and the next livekit-token request failed with ROOM_005 —
 * "no audio, no explanation". The caller uses this to back out with a message.
 */
export const useRoomSocket = (roomId: string | null, onJoinDenied?: () => void): void => {
  const qc = useQueryClient();
  // Keep the latest callback in a ref so changing it doesn't re-run the effect
  // (which would re-emit room:join / re-subscribe every render).
  const onJoinDeniedRef = useRef(onJoinDenied);
  onJoinDeniedRef.current = onJoinDenied;

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      socket.emit('room:join', { roomId }, (ok: boolean) => {
        if (!ok && !cancelled) onJoinDeniedRef.current?.();
      });

      const refreshDetail = (): void => {
        void qc.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
      };
      const refreshIfMatches = (payload: RoomEventPayload | undefined): void => {
        if (!payload || payload.roomId === roomId) refreshDetail();
      };
      // Hand-raise events must also refresh the dedicated hand-raises query (the
      // speaker-request queue) — it lives under a separate key, so the detail
      // invalidation alone left it stale while realtime is on (the prod config).
      const refreshHandQueue = (payload: RoomEventPayload | undefined): void => {
        if (payload && payload.roomId !== roomId) return;
        refreshDetail();
        void qc.invalidateQueries({ queryKey: roomKeys.handRaises(roomId) });
      };

      socket.on('room:user-joined', refreshIfMatches);
      socket.on('room:user-left', refreshIfMatches);
      socket.on('room:role_changed', refreshIfMatches);
      socket.on('room:hand_raised', refreshHandQueue);
      socket.on('room:hand_lowered', refreshHandQueue);
      socket.on('room:mute-changed', refreshDetail);
      socket.on('room:user_kicked', refreshIfMatches);
      socket.on('room:ended', refreshIfMatches);
      // Live edits to the room itself (title, chatEnabled, chatVisibility).
      // Triggered by host actions in RoomControlsSheet / TitleEditModal.
      socket.on('room:meta_updated', refreshIfMatches);

      cleanup = () => {
        socket.emit('room:leave', { roomId });
        socket.off('room:user-joined', refreshIfMatches);
        socket.off('room:user-left', refreshIfMatches);
        socket.off('room:role_changed', refreshIfMatches);
        socket.off('room:hand_raised', refreshHandQueue);
        socket.off('room:hand_lowered', refreshHandQueue);
        socket.off('room:mute-changed', refreshDetail);
        socket.off('room:user_kicked', refreshIfMatches);
        socket.off('room:ended', refreshIfMatches);
        socket.off('room:meta_updated', refreshIfMatches);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [roomId, qc]);
};
