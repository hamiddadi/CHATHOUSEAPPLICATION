import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { setReporterEnabled } from '../../../core/observability/reporter';

const KEY = 'chathouse.consent.analytics.v1';

/**
 * Opt-in consent for crash + telemetry reporting. Persisted in AsyncStorage
 * so it survives restarts (non-sensitive boolean — moved off expo-secure-store
 * in the de-Expo migration). Default: disabled — the user
 * must actively turn it on (GDPR consent must be unambiguous).
 *
 * The reporter (Sentry) is gated by `setReporterEnabled` so disabling the
 * toggle stops outbound events immediately, not just from the next launch.
 */
interface AnalyticsConsentState {
  enabled: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (next: boolean) => Promise<void>;
}

export const useAnalyticsConsentStore = create<AnalyticsConsentState>((set, get) => ({
  enabled: false,
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const enabled = raw === '1';
      set({ enabled, isHydrated: true });
      setReporterEnabled(enabled);
    } catch {
      set({ isHydrated: true });
      setReporterEnabled(false);
    }
  },

  setEnabled: async next => {
    await AsyncStorage.setItem(KEY, next ? '1' : '0');
    set({ enabled: next });
    setReporterEnabled(next);
  },
}));
