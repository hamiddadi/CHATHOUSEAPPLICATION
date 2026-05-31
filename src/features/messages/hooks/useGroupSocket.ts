import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useAuthStore } from '../../auth/store/authStore';
import { groupKeys } from './useGroups';

/**
 * Subscribes to the `group:message` event and invalidates the group list +
 * the affected thread so the UI updates live. Mirrors useChatSocket; the
 * socket is a singleton so mounting in multiple places is safe.
 */
export const useGroupSocket = (): void => {
  const qc = useQueryClient();
  const isAuthed = useAuthStore(s => s.status === 'authenticated');

  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    let unbind: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;

      const onMessage = (msg: { conversationId?: string }): void => {
        void qc.invalidateQueries({ queryKey: groupKeys.list() });
        if (msg.conversationId) {
          void qc.invalidateQueries({ queryKey: groupKeys.messages(msg.conversationId) });
        }
      };

      socket.on('group:message', onMessage);
      unbind = () => socket.off('group:message', onMessage);
    })();

    return () => {
      cancelled = true;
      unbind?.();
    };
  }, [isAuthed, qc]);
};
