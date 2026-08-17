import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { apiClient } from '../../../shared/services/api/apiClient';

const KEY = 'chathouse.ghostMode.v1';

interface GhostModeState {
  isGhost: boolean;
  isHydrated: boolean;
  isToggling: boolean;
  hydrate: () => Promise<void>;
  toggle: () => Promise<void>;
  setGhost: (next: boolean) => Promise<void>;
}

/**
 * The server is the source of truth because only a successful visibility
 * update can guarantee that stored coordinates were cleared. AsyncStorage
 * mirrors the confirmed server state for startup/offline rendering.
 */
export const useGhostModeStore = create<GhostModeState>((set, get) => ({
  isGhost: false,
  isHydrated: false,
  isToggling: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      set({ isGhost: raw === '1', isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },

  setGhost: async next => {
    // Do not show "hidden" until the durable server update succeeds. The
    // backend clears coordinates and emits maps:user-offline from this path.
    await apiClient.patch('/users/me/visibility', { isVisible: !next });
    set({ isGhost: next });

    // Persistence failure must not roll back a privacy change already accepted
    // by the server. Hydration will be corrected by the next confirmed toggle.
    try {
      await AsyncStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* server-confirmed state remains authoritative */
    }
  },

  toggle: async () => {
    // Guard against a double-tap firing two overlapping async toggles.
    if (get().isToggling) return;
    set({ isToggling: true });
    try {
      await get().setGhost(!get().isGhost);
    } finally {
      set({ isToggling: false });
    }
  },
}));
