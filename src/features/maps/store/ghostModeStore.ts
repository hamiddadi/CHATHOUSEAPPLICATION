import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

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
    await SecureStore.setItemAsync(KEY, next ? '1' : '0');
    set({ isGhost: next });
    // TODO: call apiClient.post('/me/presence/ghost', { isGhost: next }) when backend ships.
  },

  toggle: async () => {
    await get().setGhost(!get().isGhost);
  },
}));
