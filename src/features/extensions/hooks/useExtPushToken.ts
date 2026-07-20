import { useEffect, useRef, useState } from 'react';
import messaging from '@react-native-firebase/messaging';
import {
  pushService,
  requestNotificationPermission,
} from '../../notifications/services/pushService';

/**
 * FCM push-token registration (Module 10 / NOTIF-016) — de-Expo: replaces the
 * `expo-notifications` token fetch with Firebase Cloud Messaging
 * (`@react-native-firebase/messaging`). POSTs the token to the real backend
 * route `/push/register` through the central push service, including safe
 * account-switch rotation and token-refresh handling. Re-registering a token
 * already owned by the same account is idempotent. (Previously it POSTed to
 * three non-existent routes — /push/tokens,
 * /users/me/push-tokens, /ext/push/tokens — and always errored.)
 */

export const useExtPushToken = (enabled = true) => {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'asking' | 'denied' | 'registered' | 'error'>(
    'idle',
  );
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unsubscribeRefresh: (() => void) | undefined;

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

        unsubscribeRefresh = messaging().onTokenRefresh(refreshed => {
          if (cancelled) return;
          setToken(refreshed);
          void pushService.registerTokenWithBackend(refreshed).then(registered => {
            if (cancelled) return;
            if (registered) {
              lastSentRef.current = refreshed;
              setStatus('registered');
            } else {
              setStatus('error');
            }
          });
        });

        if (lastSentRef.current === fetched) {
          setStatus('registered');
          return;
        }
        const ok = await pushService.registerTokenWithBackend(fetched);
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
      unsubscribeRefresh?.();
    };
  }, [enabled]);

  return { token, status };
};
