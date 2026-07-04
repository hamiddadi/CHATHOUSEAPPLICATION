import messaging from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * Device push registration via Firebase Cloud Messaging (de-Expo: replaces
 * `expo-notifications` + Expo's hosted push proxy). `google-services.json`
 * (android/app/) wires the FCM project; the native SDK mints a registration
 * token we POST to the backend, which fans out through firebase-admin.
 *
 * Push needs a native module, so it only works in a real build (not unit
 * tests / web) — `@react-native-firebase/messaging` is mocked under jest.
 */

let cachedToken: string | null = null;

/**
 * Outcome of the permission/token flow, surfaced so UI (e.g. the onboarding
 * notifications step) can explain a refusal instead of failing silently:
 * - 'granted'  permission OK (token may still be null only on 'error')
 * - 'denied'   user refused, the OS may re-prompt later
 * - 'blocked'  user refused permanently ("never ask again" / iOS denial) —
 *              only the system settings screen can re-enable it
 * - 'error'    native module/token unavailable (emulator, tests, web)
 */
export type PushPermissionStatus = 'granted' | 'denied' | 'blocked' | 'error';

/**
 * Ask the OS for notification permission and report the detailed outcome.
 * Android 13+ (API 33) gates notifications behind the runtime
 * POST_NOTIFICATIONS permission ('never_ask_again' → 'blocked'); older Android
 * grants implicitly. iOS goes through the APNs authorisation prompt — once
 * denied there, the OS never re-prompts, so a denial maps to 'blocked'.
 */
export const requestNotificationPermissionStatus = async (): Promise<PushPermissionStatus> => {
  if (Platform.OS === 'android') {
    if (Platform.Version >= 33) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
      if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
      return 'denied';
    }
    return 'granted';
  }
  const authStatus = await messaging().requestPermission();
  if (
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL
  ) {
    return 'granted';
  }
  return authStatus === messaging.AuthorizationStatus.DENIED ? 'blocked' : 'denied';
};

/**
 * Boolean convenience over `requestNotificationPermissionStatus`. Shared with
 * `useExtPushToken` so both token paths use one permission flow.
 */
export const requestNotificationPermission = async (): Promise<boolean> =>
  (await requestNotificationPermissionStatus()) === 'granted';

export const pushService = {
  /**
   * Ask for permission and grab the FCM registration token. Returns the token
   * string (null when permission is refused or the native module/token is
   * unavailable — emulator without Play Services, tests, web) alongside the
   * permission status so callers can tell a refusal from a technical failure.
   */
  async getOrRequestToken(): Promise<{ token: string | null; status: PushPermissionStatus }> {
    if (cachedToken) return { token: cachedToken, status: 'granted' };
    try {
      const status = await requestNotificationPermissionStatus();
      if (status !== 'granted') return { token: null, status };
      const token = await messaging().getToken();
      cachedToken = token || null;
      return { token: cachedToken, status: cachedToken ? 'granted' : 'error' };
    } catch (err) {
      if (__DEV__) {
        console.warn('[push] FCM token fetch failed', err);
      }
      return { token: null, status: 'error' };
    }
  },

  /**
   * Clear the in-memory token cache. The token is bound to the device (not the
   * account), but the cache must drop on a user switch so a stale association
   * can't be reused. `signOut()` already calls `unregisterCurrentDevice()`
   * (which clears the cache); this is the side-effect-free reset for any auth
   * flow that swaps users without a full sign-out round-trip.
   */
  resetTokenCache(): void {
    cachedToken = null;
  },

  /**
   * Register the device's FCM token with the backend. Idempotent (backend
   * upserts on `token`). Always re-POSTs — even when cached — so calling it on
   * every login re-associates the device with the current account. Invoke after
   * each successful authentication, not only on first boot. Returns the
   * permission status so UI callers can surface a refusal; registration
   * failures themselves stay best-effort and never throw.
   */
  async registerWithBackend(): Promise<PushPermissionStatus> {
    const { token, status } = await this.getOrRequestToken();
    if (!token) return status;
    await apiClient
      .post('/push/register', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' })
      .catch(() => undefined);
    return status;
  },

  async unregisterCurrentDevice(): Promise<void> {
    if (!cachedToken) return;
    const token = cachedToken;
    cachedToken = null;
    await apiClient.post('/push/unregister', { token }).catch(() => undefined);
  },
};
