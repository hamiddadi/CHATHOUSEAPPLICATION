import {
  AuthorizationStatus,
  deleteToken,
  getMessaging,
  getToken,
  requestPermission,
} from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import { apiClient } from '../../../shared/services/api/apiClient';
import { isAppError } from '../../../shared/services/api/errorHandler';

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
const firebaseMessaging = getMessaging();
const backendPlatform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

/**
 * Claim a concrete FCM token for the authenticated account. A 409 PUSH_001
 * means the token is still bound to a previous account on this installation.
 * Invalidate it locally (so the previous backend row can no longer receive)
 * and claim the new FCM token once; network errors never rotate tokens.
 */
const registerToken = async (token: string, allowRotation = true): Promise<boolean> => {
  try {
    await apiClient.post('/push/register', { token, platform: backendPlatform() });
    cachedToken = token;
    return true;
  } catch (err) {
    if (!allowRotation || !isAppError(err) || err.code !== 'PUSH_001') return false;
    try {
      await deleteToken(firebaseMessaging);
      cachedToken = null;
      const replacement = await getToken(firebaseMessaging);
      if (!replacement || replacement === token) return false;
      return registerToken(replacement, false);
    } catch {
      return false;
    }
  }
};

/**
 * Outcome of the permission/token flow, surfaced so UI (e.g. the onboarding
 * notifications step) can explain a refusal instead of failing silently:
 * - 'granted'  permission OK (token may still be null only on 'error')
 * - 'denied'   user refused, the OS may re-prompt later
 * - 'blocked'  user refused permanently ("never ask again" / iOS denial) —
 *              only the system settings screen can re-enable it
 * - 'error'    native module/token unavailable or backend registration failed
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
  const authStatus = await requestPermission(firebaseMessaging);
  if (
    authStatus === AuthorizationStatus.AUTHORIZED ||
    authStatus === AuthorizationStatus.PROVISIONAL
  ) {
    return 'granted';
  }
  return authStatus === AuthorizationStatus.DENIED ? 'blocked' : 'denied';
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
      const token = await getToken(firebaseMessaging);
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
   * Register the device's FCM token with the backend. Re-registering it for
   * the same account is idempotent; a token still bound to another account is
   * invalidated and rotated before one retry. Invoke after each successful
   * authentication. Failures remain best-effort and never block login.
   */
  async registerWithBackend(): Promise<PushPermissionStatus> {
    const { token, status } = await this.getOrRequestToken();
    if (!token) return status;
    const registered = await registerToken(token);
    return registered ? 'granted' : 'error';
  },

  async registerTokenWithBackend(token: string): Promise<boolean> {
    return registerToken(token);
  },

  async unregisterCurrentDevice(): Promise<void> {
    let token = cachedToken;
    if (!token) {
      try {
        token = await getToken(firebaseMessaging);
      } catch {
        token = null;
      }
    }
    cachedToken = null;
    if (token) {
      await apiClient.post('/push/unregister', { token }).catch(() => undefined);
    }
    // Even if the API call failed because the access token expired, deleting
    // the local FCM token makes the stale backend mapping undeliverable. FCM
    // will mint a fresh token for the next signed-in account.
    await deleteToken(firebaseMessaging).catch(() => undefined);
  },
};
