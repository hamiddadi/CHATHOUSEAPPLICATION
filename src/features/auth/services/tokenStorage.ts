import * as Keychain from 'react-native-keychain';
import { z } from 'zod';
import type { AuthSession } from '../types/auth.types';

// Auth session stored in the hardware-backed Android Keystore via
// react-native-keychain (de-Expo: was an expo-secure-store key). The get/set/
// clear facade is intentionally unchanged so interceptors / authStore /
// socketClient need no changes. One-time effect of the migration: existing
// users are logged out once (the old expo-secure-store entry is not read).
const SERVICE = 'chathouse.auth.session.v1';
// Process-local authority used by interceptors/socket bootstrap. It also keeps
// a freshly rotated session usable when the OS Keychain rejects persistence;
// after a restart, any older recovery credential is rejected server-side.
let volatileSession: AuthSession | null = null;
// Set only when native deletion fails: prevents this process from re-reading
// the stale persisted bearer after the caller has explicitly signed out.
let suppressPersistentRead = false;
const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  // Sessions persisted before explicit recovery scopes are regular active
  // sessions; defaulting preserves that bounded rollout compatibility.
  scope: z.enum(['active', 'account_recovery']).default('active'),
});

export const tokenStorage = {
  async get(): Promise<AuthSession | null> {
    if (volatileSession) return volatileSession;
    if (suppressPersistentRead) return null;
    try {
      const creds = await Keychain.getGenericPassword({ service: SERVICE });
      if (!creds) return null;
      const parsed: unknown = JSON.parse(creds.password);
      volatileSession = authSessionSchema.parse(parsed);
      return volatileSession;
    } catch {
      return null;
    }
  },

  async set(session: AuthSession): Promise<void> {
    // Update memory before crossing the fallible native persistence boundary.
    volatileSession = session;
    suppressPersistentRead = false;
    await Keychain.setGenericPassword('chathouse', JSON.stringify(session), {
      service: SERVICE,
    });
  },

  async clear(): Promise<void> {
    volatileSession = null;
    suppressPersistentRead = true;
    await Keychain.resetGenericPassword({ service: SERVICE });
    suppressPersistentRead = false;
  },
};
