import * as Keychain from 'react-native-keychain';
import { z } from 'zod';
import type { AuthSession } from '../types/auth.types';

// Auth session stored in the hardware-backed Android Keystore via
// react-native-keychain (de-Expo: was an expo-secure-store key). The get/set/
// clear facade is intentionally unchanged so interceptors / authStore /
// socketClient need no changes. One-time effect of the migration: existing
// users are logged out once (the old expo-secure-store entry is not read).
const SERVICE = 'chathouse.auth.session.v1';
const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
});

export const tokenStorage = {
  async get(): Promise<AuthSession | null> {
    try {
      const creds = await Keychain.getGenericPassword({ service: SERVICE });
      if (!creds) return null;
      const parsed: unknown = JSON.parse(creds.password);
      return authSessionSchema.parse(parsed);
    } catch {
      return null;
    }
  },

  async set(session: AuthSession): Promise<void> {
    await Keychain.setGenericPassword('chathouse', JSON.stringify(session), {
      service: SERVICE,
    });
  },

  async clear(): Promise<void> {
    await Keychain.resetGenericPassword({ service: SERVICE });
  },
};
