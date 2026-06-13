import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { apiClient } from '../../../shared/services/api/apiClient';
import { getSocket } from '../../../shared/services/realtime/socketClient';

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
 * Ghost Mode is persisted locally via AsyncStorage so the user's preference
 * survives app restarts even before the network sync succeeds. (Non-sensitive
 * boolean flag — moved off expo-secure-store in the de-Expo migration.)
 * When the backend is wired, `setGhost` should also POST /me/presence/ghost.
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
    // Persist optimistically — the local value is the source of truth
    // when the user opens the app offline. Backend sync is best-effort.
    await AsyncStorage.setItem(KEY, next ? '1' : '0');
    set({ isGhost: next });

    // CRITICAL: tell the realtime server NOW so our last broadcast position is
    // removed from every other viewer's map. The backend only emits
    // `maps:user-offline` when it receives `maps:toggle-visibility` — it does
    // NOT infer Ghost Mode from the REST PATCH. Without this emit, the last
    // GPS position stays visible to followers until the socket disconnects.
    try {
      const socket = await getSocket();
      socket?.emit('maps:toggle-visibility', { isVisible: !next });
    } catch {
      /* best-effort — REST PATCH below is the durable source of truth */
    }

    try {
      await apiClient.patch('/users/me/visibility', { isVisible: !next });
    } catch {
      // Silent: local state already reflects the user's choice; the sync will
      // be retried on the next toggle.
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
