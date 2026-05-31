import { useEffect } from 'react';
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
 */
export const useRoomSocket = (roomId: string | null): void => {
  const qc = useQueryClient();

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      socket.emit('room:join', { roomId });

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
