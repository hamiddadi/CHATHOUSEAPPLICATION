import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * Presence heartbeat — keeps the user marked as online in the backend
 * by emitting a periodic socket signal AND a fallback HTTP touch.
 *
 * The socket emit is preferred: a single `presence_update` event lets the
 * server refresh `User.isOnline` / `lastSeenAt`. The HTTP fallback
 * (`POST /api/users/me/heartbeat`) covers the case where the socket is down.
 *
 * Stops when the app goes to background to save battery (matches
 * Clubhouse's behaviour where you appear offline ~30 s after backgrounding).
 */

const FOREGROUND_INTERVAL_MS = 30_000;
const SOCKET_EVENT = 'presence_update';

const tryHttpHeartbeat = async (): Promise<void> => {
  // Single real route (POST /api/users/me/heartbeat). Used only when the socket
  // is down — the `presence_update` socket event is the preferred path. Errors
  // are swallowed: a missed heartbeat is never worth surfacing to the user.
  await apiClient.post('/users/me/heartbeat', {}).catch(() => undefined);
};

export const useExtPresenceHeartbeat = (enabled = true): void => {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>('active');

  useEffect(() => {
    if (!enabled) return;

    const beat = async (): Promise<void> => {
      if (appStateRef.current !== 'active') return;
      try {
        const socket = await getSocket();
        if (socket?.connected) {
          socket.emit(SOCKET_EVENT, { at: Date.now() });
          return;
        }
      } catch {
        /* fall through */
      }
      await tryHttpHeartbeat().catch(() => undefined);
    };

    void beat();
    timerRef.current = setInterval(() => void beat(), FOREGROUND_INTERVAL_MS);

    const sub = AppState.addEventListener('change', next => {
      appStateRef.current = next;
      if (next === 'active') void beat();
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      sub.remove();
    };
  }, [enabled]);
};
