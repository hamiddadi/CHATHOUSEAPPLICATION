import * as SecureStore from 'expo-secure-store';
import type { AuthSession } from '../types/auth.types';

const KEY = 'chathouse.auth.session.v1';

export const tokenStorage = {
  async get(): Promise<AuthSession | null> {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  },

  async set(session: AuthSession): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  },

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  },
};
