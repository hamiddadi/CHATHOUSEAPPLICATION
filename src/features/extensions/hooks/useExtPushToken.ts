import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * Expo / FCM / APNs push token registration (Module 10 / NOTIF-016).
 *
 * Lazy-loads `expo-notifications` to keep the hook importable on web. On
 * permission grant + token fetch, POSTs to the existing `/api/push/tokens`
 * route (with fallback paths). Idempotent: re-registers only when the
 * device token changes.
 */

interface NotificationsModule {
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: () => Promise<{ data: string }>;
  setNotificationHandler?: (h: unknown) => void;
}

const PATHS = ['/push/tokens', '/users/me/push-tokens', '/ext/push/tokens'];

const postToken = async (token: string, platform: string): Promise<boolean> => {
  for (const p of PATHS) {
    try {
      await apiClient.post(p, { token, platform });
      return true;
    } catch (err) {
      // Errors arrive as the normalised AppError ({ kind, status }); there is
      // no raw `err.response`. Only try the next path when the route is missing
      // (404/405) — a real error (500, network, 403) must stop the loop instead
      // of re-POSTing the token to every fallback path.
      const e = err as { status?: number; kind?: string };
      if (e.kind === 'notFound' || e.status === 404 || e.status === 405) continue;
      return false; // real error — stop instead of spamming the other paths
    }
  }
  return false;
};

export const useExtPushToken = (enabled = true) => {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'asking' | 'denied' | 'registered' | 'error'>(
    'idle',
  );
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      try {
        setStatus('asking');
        // Synchronous `require` (NOT dynamic `import()`, which hermesc rejects
        // in release builds — "Invalid expression encountered"). expo-notifications
        // is installed, so this resolves normally; the guard keeps it safe on
        // web/tests where the native module is absent.
        let Notifications: NotificationsModule | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
          Notifications = require('expo-notifications') as NotificationsModule;
        } catch {
          Notifications = null;
        }
        if (!Notifications?.getPermissionsAsync) {
          if (!cancelled) setStatus('error');
          return;
        }

        let perm = await Notifications.getPermissionsAsync();
        if (perm.status !== 'granted') {
          perm = await Notifications.requestPermissionsAsync();
        }
        if (perm.status !== 'granted') {
          if (!cancelled) setStatus('denied');
          return;
        }

        const fetched = await Notifications.getExpoPushTokenAsync();
        if (cancelled || !fetched?.data) return;
        setToken(fetched.data);

        if (lastSentRef.current === fetched.data) {
          setStatus('registered');
          return;
        }
        const ok = await postToken(fetched.data, Platform.OS);
        if (!cancelled) {
          if (ok) {
            lastSentRef.current = fetched.data;
            setStatus('registered');
          } else {
            setStatus('error');
          }
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { token, status };
};
