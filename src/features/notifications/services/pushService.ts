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
 * Ask the OS for notification permission. Android 13+ (API 33) gates
 * notifications behind the runtime POST_NOTIFICATIONS permission; older Android
 * grants implicitly. iOS goes through the APNs authorisation prompt. Shared
 * with `useExtPushToken` so both token paths use one permission flow.
 */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'android') {
    if (Platform.Version >= 33) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }
  const authStatus = await messaging().requestPermission();
  return (
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL
  );
};

export const pushService = {
  /**
   * Ask for permission and grab the FCM registration token. Returns the token
   * string, or null when permission is denied or the native module/token is
   * unavailable (emulator without Play Services, tests, web).
   */
  async getOrRequestToken(): Promise<string | null> {
    if (cachedToken) return cachedToken;
    try {
      if (!(await requestNotificationPermission())) return null;
      const token = await messaging().getToken();
      cachedToken = token || null;
      return cachedToken;
    } catch (err) {
      if (__DEV__) {
        console.warn('[push] FCM token fetch failed', err);
      }
      return null;
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
   * each successful authentication, not only on first boot.
   */
  async registerWithBackend(): Promise<void> {
    const token = await this.getOrRequestToken();
    if (!token) return;
    await apiClient
      .post('/push/register', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' })
      .catch(() => undefined);
  },

  async unregisterCurrentDevice(): Promise<void> {
    if (!cachedToken) return;
    const token = cachedToken;
    cachedToken = null;
    await apiClient.post('/push/unregister', { token }).catch(() => undefined);
  },
};
