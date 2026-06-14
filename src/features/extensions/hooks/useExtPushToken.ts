import { useEffect, useRef, useState } from 'react';
import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import { requestNotificationPermission } from '../../notifications/services/pushService';
import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * FCM push-token registration (Module 10 / NOTIF-016) — de-Expo: replaces the
 * `expo-notifications` token fetch with Firebase Cloud Messaging
 * (`@react-native-firebase/messaging`). POSTs the token to the real backend
 * route `/push/register` (the backend upserts on the token, so this is
 * idempotent + safe to co-exist with pushService.registerWithBackend, which
 * hits the same route on login). Re-registers only when the device token
 * changes. (Previously it POSTed to three non-existent routes — /push/tokens,
 * /users/me/push-tokens, /ext/push/tokens — and always errored.)
 */

const REGISTER_PATH = '/push/register';

const postToken = async (token: string, platform: string): Promise<boolean> => {
  try {
    await apiClient.post(REGISTER_PATH, { token, platform });
    return true;
  } catch {
    return false;
  }
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
