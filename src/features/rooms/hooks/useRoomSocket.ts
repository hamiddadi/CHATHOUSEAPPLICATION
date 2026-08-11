import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, onReconnect } from '../../../shared/services/realtime/socketClient';
import {
  clearRoomSocketAdmission,
  ensureRoomSocketAdmission,
  RoomSocketAdmissionError,
} from '../services/roomSocketAdmission';
import { useAuthStore } from '../../auth/store/authStore';
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
export const useRoomSocket = (roomId: string | null, onJoinDenied?: () => void): boolean => {
  const qc = useQueryClient();
  const [admittedRoomId, setAdmittedRoomId] = useState<string | null>(null);
  // Keep the latest callback in a ref so changing it doesn't re-run the effect
  // (which would re-emit room:join / re-subscribe every render).
  const onJoinDeniedRef = useRef(onJoinDenied);
  onJoinDeniedRef.current = onJoinDenied;

  useEffect(() => {
    setAdmittedRoomId(null);
    if (!roomId) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let joinGeneration = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const emitJoin = (retryAttempt = 0): void => {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        const generation = ++joinGeneration;
        setAdmittedRoomId(null);
        void ensureRoomSocketAdmission(socket, roomId)
          .then(() => {
            if (cancelled || generation !== joinGeneration) return;
            setAdmittedRoomId(roomId);
          })
          .catch(error => {
            if (cancelled || generation !== joinGeneration) return;
            setAdmittedRoomId(null);
            if (error instanceof RoomSocketAdmissionError && error.reason === 'superseded') {
              return;
            }
            if (!(error instanceof RoomSocketAdmissionError) || error.reason !== 'denied') {
              if (retryAttempt < 2) {
                retryTimer = setTimeout(() => emitJoin(retryAttempt + 1), 250 * 2 ** retryAttempt);
                return;
              }
            }
            onJoinDeniedRef.current?.();
          });
      };
      emitJoin();

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
      const handleRoomEnded = (payload: RoomEventPayload | undefined): void => {
        if (payload && payload.roomId !== roomId) return;
        clearRoomSocketAdmission(roomId);
        refreshDetail();
      };
      const handleUserKicked = (
        payload: (RoomEventPayload & { userId?: string }) | undefined,
      ): void => {
        if (payload?.roomId && payload.roomId !== roomId) return;
        if (payload?.userId === useAuthStore.getState().user?.id) {
          clearRoomSocketAdmission(roomId);
        }
        refreshDetail();
      };

      socket.on('room:user-joined', refreshIfMatches);
      socket.on('room:user-left', refreshIfMatches);
      socket.on('room:role_changed', refreshIfMatches);
      socket.on('room:hand_raised', refreshHandQueue);
      socket.on('room:hand_lowered', refreshHandQueue);
      socket.on('room:mute-changed', refreshDetail);
      socket.on('room:user_kicked', handleUserKicked);
      socket.on('room:ended', handleRoomEnded);
      // Live edits to the room itself (title, chatEnabled, chatVisibility).
      // Triggered by host actions in RoomControlsSheet / TitleEditModal.
      socket.on('room:meta_updated', refreshIfMatches);

      // After a socket RE-connection the server has dropped our per-room
      // channel membership (a fresh connection joins nothing), so every
      // room:* broadcast above would stay silent forever. Re-join the room
      // channel and resync the detail + hand queue for the gap we missed.
      const unsubscribeReconnect = onReconnect(() => {
        emitJoin();
        refreshHandQueue(undefined);
      });

      cleanup = () => {
        unsubscribeReconnect();
        // Unmounting RoomScreen can mean "minimize to the mini-bar", not an
        // account-level leave. Keep the socket in the room channel so the
        // persistent audio session still receives ended/kicked events. The
        // explicit Leave action calls the authenticated REST endpoint, whose
        // server-side lifecycle evicts every device from this channel.
        socket.off('room:user-joined', refreshIfMatches);
        socket.off('room:user-left', refreshIfMatches);
        socket.off('room:role_changed', refreshIfMatches);
        socket.off('room:hand_raised', refreshHandQueue);
        socket.off('room:hand_lowered', refreshHandQueue);
        socket.off('room:mute-changed', refreshDetail);
        socket.off('room:user_kicked', handleUserKicked);
        socket.off('room:ended', handleRoomEnded);
        socket.off('room:meta_updated', refreshIfMatches);
      };
    })();

    return () => {
      cancelled = true;
      joinGeneration += 1;
      if (retryTimer) clearTimeout(retryTimer);
      cleanup?.();
    };
  }, [roomId, qc]);

  return roomId !== null && admittedRoomId === roomId;
};
