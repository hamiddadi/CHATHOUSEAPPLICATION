import { useEffect, useRef, useState } from 'react';
import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import { requestNotificationPermission } from '../../notifications/services/pushService';
import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * FCM push-token registration (Module 10 / NOTIF-016) — de-Expo: replaces the
 * `expo-notifications` token fetch with Firebase Cloud Messaging
 * (`@react-native-firebase/messaging`). On permission grant + token fetch,
 * POSTs to the existing push-token route (with fallback paths). Idempotent:
 * re-registers only when the device token changes.
 */

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
        const granted = await requestNotificationPermission();
        if (cancelled) return;
        if (!granted) {
          setStatus('denied');
          return;
        }

        const fetched = await messaging().getToken();
        if (cancelled || !fetched) return;
        setToken(fetched);

        if (lastSentRef.current === fetched) {
          setStatus('registered');
          return;
        }
        const ok = await postToken(fetched, Platform.OS);
        if (!cancelled) {
          if (ok) {
            lastSentRef.current = fetched;
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
