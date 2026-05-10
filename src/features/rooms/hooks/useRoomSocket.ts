import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
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
    let boundSocket: Socket | null = null;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;
      boundSocket = socket;

      socket.emit('room:join', { roomId });

      const refreshDetail = (): void => {
        void qc.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
      };
      const refreshIfMatches = (payload: RoomEventPayload | undefined): void => {
        if (!payload || payload.roomId === roomId) refreshDetail();
      };

      socket.on('room:user-joined', refreshIfMatches);
      socket.on('room:user-left', refreshIfMatches);
      socket.on('room:role_changed', refreshIfMatches);
      socket.on('room:hand_raised', refreshIfMatches);
      socket.on('room:hand_lowered', refreshIfMatches);
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
        socket.off('room:hand_raised', refreshIfMatches);
        socket.off('room:hand_lowered', refreshIfMatches);
        socket.off('room:mute-changed', refreshDetail);
        socket.off('room:user_kicked', refreshIfMatches);
        socket.off('room:ended', refreshIfMatches);
        socket.off('room:meta_updated', refreshIfMatches);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
      boundSocket = null;
      void boundSocket;
    };
  }, [roomId, qc]);
};
