import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useAuthStore } from '../../auth/store/authStore';
import { messageKeys } from './useMessages';

/**
 * Subscribes to the `chat:message` and `chat:read` events on the shared
 * socket and invalidates React Query caches so the UI reflects reality
 * without manual refetches. Safe to mount in multiple places — the
 * socket is a singleton; handlers dedupe via `.off` in cleanup.
 */
export const useChatSocket = (): void => {
  const qc = useQueryClient();
  const isAuthed = useAuthStore(s => s.status === 'authenticated');

  useEffect(() => {
    if (!isAuthed) return;
    let unbind: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (!socket) return;

      const onMessage = (msg: { senderId: string; receiverId: string }): void => {
        const me = useAuthStore.getState().user?.id;
        if (!me) return;
        // Either direction refreshes the list + the relevant thread.
        const peerId = msg.senderId === me ? msg.receiverId : msg.senderId;
        void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
        void qc.invalidateQueries({ queryKey: messageKeys.unread() });
        if (peerId) {
          void qc.invalidateQueries({ queryKey: messageKeys.messages(peerId) });
        }
      };

      const onRead = (): void => {
        // When the peer reads our message, the conversation preview
        // changes (unread on their side; isRead flag echoes back).
        void qc.invalidateQueries({ queryKey: messageKeys.conversations() });
      };

      socket.on('chat:message', onMessage);
      socket.on('chat:read', onRead);

      unbind = () => {
        socket.off('chat:message', onMessage);
        socket.off('chat:read', onRead);
      };
    })();

    return () => {
      unbind?.();
    };
  }, [isAuthed, qc]);
};
