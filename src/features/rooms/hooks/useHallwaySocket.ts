import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useAuthStore } from '../../auth/store/authStore';
import { roomKeys } from './useRooms';

/**
 * Bridges the backend `hallway:*` broadcasts into React Query so the
 * RoomFeed refreshes without a manual pull. The backend fires:
 *   - hallway:room_created  (new public live room)
 *   - hallway:room_closed   (host ended the room)
 *   - hallway:room_updated  (participant count, title)
 * All three simply invalidate `roomKeys.list()` — the feed refetches
 * the scored list rather than patching individual rows, which keeps
 * ranking consistent without client-side re-scoring.
 */
export const useHallwaySocket = (): void => {
  const qc = useQueryClient();
  const isAuthed = useAuthStore(s => s.status === 'authenticated');

  useEffect(() => {
    if (!isAuthed) return;
    // Race-safety: isAuthed can flip true→false (logout) while getSocket()
    // is still pending. Without `cancelled`, the async block resumes after
    // the cleanup already ran (unbind was undefined then), attaches the
    // listeners, and they leak forever past disconnect.
    let cancelled = false;
    let unbind: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;

      const refreshFeed = (): void => {
        void qc.invalidateQueries({ queryKey: roomKeys.list() });
      };

      socket.on('hallway:room_created', refreshFeed);
      socket.on('hallway:room_closed', refreshFeed);
      socket.on('hallway:room_updated', refreshFeed);

      unbind = () => {
        socket.off('hallway:room_created', refreshFeed);
        socket.off('hallway:room_closed', refreshFeed);
        socket.off('hallway:room_updated', refreshFeed);
      };
    })();

    return () => {
      cancelled = true;
      unbind?.();
    };
  }, [isAuthed, qc]);
};
