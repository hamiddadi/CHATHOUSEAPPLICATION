import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { apiClient } from '../../../shared/services/api/apiClient';

const KEY = 'chathouse.ghostMode.v1';

interface GhostModeState {
  isGhost: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  toggle: () => Promise<void>;
  setGhost: (next: boolean) => Promise<void>;
}

/**
 * Ghost Mode is persisted locally via SecureStore so the user's preference
 * survives app restarts even before the network sync succeeds.
 * When the backend is wired, `setGhost` should also POST /me/presence/ghost.
 */
export const useGhostModeStore = create<GhostModeState>((set, get) => ({
  isGhost: false,
  isHydrated: false,

  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      set({ isGhost: raw === '1', isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },

  setGhost: async next => {
    // Persist optimistically — the SecureStore value is the source of truth
    // when the user opens the app offline. Backend sync is best-effort.
    await SecureStore.setItemAsync(KEY, next ? '1' : '0');
    set({ isGhost: next });
    try {
      await apiClient.patch('/users/me/visibility', { isVisible: !next });
    } catch {
      // Silent: local state already reflects the user's choice; the sync will
      // be retried on the next toggle. The socket handler broadcasts
      // `maps:user-offline` on Ghost activation regardless.
    }
  },

  toggle: async () => {
    await get().setGhost(!get().isGhost);
  },
}));
