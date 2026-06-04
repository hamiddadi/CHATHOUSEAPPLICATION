import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useAuthStore } from '../../auth/store/authStore';
import { notificationKeys } from './useNotifications';

/**
 * Subscribes to the per-user `notification:new` and `notification:count`
 * events on the shared socket so the tab-bar badge + the Notifications list
 * update live, without polling. The backend emits both to the caller's
 * personal `user:<id>` channel (joined on connect by the chat handler):
 *   - `notification:new`   → a notification was created → refetch the list
 *   - `notification:count` → authoritative unread total (fires on create,
 *                            mark-one-read and mark-all-read) → set the badge
 *
 * Mirrors `useChatSocket`: mount once at the nav level. Idempotent — the
 * socket is a singleton and handlers dedupe via `.off` in cleanup.
 */
export const useNotificationSocket = (): void => {
  const qc = useQueryClient();
  const isAuthed = useAuthStore(s => s.status === 'authenticated');

  useEffect(() => {
    if (!isAuthed) return;
    // Race-safety: isAuthed can flip true→false (logout) while getSocket()
    // is still pending. Without `cancelled`, the async block resumes after
    // cleanup already ran and leaks the listeners past disconnect.
    let cancelled = false;
    let unbind: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;

      // A fresh notification arrived — refetch every cached notification list
      // variant (the `.all` prefix also covers the unread count query).
      const onNew = (): void => {
        void qc.invalidateQueries({ queryKey: notificationKeys.all });
      };

      // Authoritative unread total — write it straight into the badge query so
      // the count updates instantly (and stays correct when read elsewhere).
      const onCount = (payload: { count: number }): void => {
        if (typeof payload?.count === 'number') {
          qc.setQueryData(notificationKeys.unread(), payload.count);
        }
      };

      socket.on('notification:new', onNew);
      socket.on('notification:count', onCount);

      unbind = () => {
        socket.off('notification:new', onNew);
        socket.off('notification:count', onCount);
      };
    })();

    return () => {
      cancelled = true;
      unbind?.();
    };
  }, [isAuthed, qc]);
};
