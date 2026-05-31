import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useAuthStore } from '../../auth/store/authStore';
import type { User } from '../../../shared/types/domain';
import { profileKeys } from './useProfile';

/**
 * Keeps the signed-in user's follower count live. The backend emits
 * `user:follower_count { userId, count }` to the followed user's personal
 * channel whenever someone follows/unfollows them (see follow.service), so
 * the event always targets the current user — we patch both the `me` and the
 * `detail(userId)` profile caches without a refetch.
 *
 * Mirrors `useNotificationSocket`/`useChatSocket`: mount once at the nav level.
 */
export const useFollowerCountSocket = (): void => {
  const qc = useQueryClient();
  const isAuthed = useAuthStore(s => s.status === 'authenticated');

  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    let unbind: (() => void) | undefined;

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;

      const onCount = (payload: { userId?: string; count?: number }): void => {
        if (!payload?.userId || typeof payload.count !== 'number') return;
        const patch = (prev?: User): User | undefined =>
          prev ? { ...prev, followersCount: payload.count as number } : prev;
        qc.setQueryData<User>(profileKeys.me(), patch);
        qc.setQueryData<User>(profileKeys.detail(payload.userId), patch);
      };

      socket.on('user:follower_count', onCount);
      unbind = () => socket.off('user:follower_count', onCount);
    })();

    return () => {
      cancelled = true;
      unbind?.();
    };
  }, [isAuthed, qc]);
};
