import { Platform } from 'react-native';
import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * Device push registration. Lazy-imports `expo-notifications` +
 * `expo-device` (+ `expo-constants`) so the app still boots when those
 * packages aren't installed (bare Expo, unit tests, web preview).
 *
 * Metro's static analyser rejects `require(variable)` — each
 * `require()` call below therefore uses a string literal and is wrapped
 * in its own try/catch. The cost is a slightly repetitive helper, but
 * the runtime is a no-op when modules are missing and the tree-shaker
 * can still drop them at build time.
 */

interface ExpoNotificationsModule {
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: (opts?: { projectId?: string }) => Promise<{ data: string }>;
  setNotificationHandler: (h: {
    handleNotification: () => Promise<{
      shouldShowAlert: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }) => void;
}

interface ExpoDeviceModule {
  isDevice: boolean;
}

interface ExpoConstantsModule {
  expoConfig?: { extra?: { eas?: { projectId?: string } } };
  easConfig?: { projectId?: string };
  // 'storeClient' = Expo Go on iOS/Android (no remote push since SDK 53).
  // 'standalone'  = production / TestFlight build.
  // 'bare'        = bare workflow / EAS dev-client.
  appOwnership?: 'expo' | 'guest' | 'standalone' | null;
  executionEnvironment?: 'storeClient' | 'standalone' | 'bare';
}

/* eslint-disable @typescript-eslint/no-require-imports */
const loadNotifications = (): ExpoNotificationsModule | null => {
  try {
    return require('expo-notifications') as ExpoNotificationsModule;
  } catch {
    return null;
  }
};

const loadDevice = (): ExpoDeviceModule | null => {
  try {
    return require('expo-device') as ExpoDeviceModule;
  } catch {
    return null;
  }
};

const loadConstants = (): ExpoConstantsModule | null => {
  try {
    return require('expo-constants') as ExpoConstantsModule;
  } catch {
    return null;
  }
};
/* eslint-enable @typescript-eslint/no-require-imports */

let cachedToken: string | null = null;

export const pushService = {
  /**
   * Ask the OS for permission and grab an Expo push token. Returns the
   * token string or null when (a) modules are missing, (b) the user
   * denied permission, (c) we're on simulator/web, or (d) Expo Go on
   * SDK 53+ (which dropped remote push support — needs a dev client).
   */
  async getOrRequestToken(): Promise<string | null> {
    if (cachedToken) return cachedToken;

    // STEP 1 — detect Expo Go BEFORE touching expo-notifications. The
    // notifications module emits a noisy "not supported in Expo Go"
    // warning the moment its API is called, so we have to bail early.
    // expo-constants is always-on and free to load.
    const Constants = loadConstants();
    const inExpoGo =
      Constants?.appOwnership === 'expo' || Constants?.executionEnvironment === 'storeClient';
    if (inExpoGo) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.info('[push] skipped — Expo Go detected (use a dev client for remote push)');
      }
      return null;
    }

    const Notifications = loadNotifications();
    const Device = loadDevice();
    if (!Notifications || !Device) return null;
    if (!Device.isDevice) return null;

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    cachedToken = token.data;
    return cachedToken;
  },

  /**
   * Clear the in-memory device-token cache. The token itself is bound to the
   * physical device (not the account), but the cache must be dropped on a user
   * switch so a stale association can't be re-used. `signOut()` already calls
   * `unregisterCurrentDevice()` (which clears the cache); expose this as an
   * explicit, side-effect-free reset for any auth flow that swaps users without
   * a full sign-out round-trip.
   */
  resetTokenCache(): void {
    cachedToken = null;
  },

  /**
   * Register the current device's push token with the backend. Idempotent
   * (backend upserts on `token`). Always re-POSTs — even when the token is
   * cached — so calling it on every login re-associates the device with the
   * current account. Invoke after each successful authentication, not only on
   * first boot.
   */
  async registerWithBackend(): Promise<void> {
    const token = await this.getOrRequestToken();
    if (!token) return;
    await apiClient
      .post('/push/register', {
        token,
        platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'expo',
      })
      .catch(() => undefined);
  },

  async unregisterCurrentDevice(): Promise<void> {
    if (!cachedToken) return;
    const token = cachedToken;
    cachedToken = null;
    await apiClient.post('/push/unregister', { token }).catch(() => undefined);
  },
};
