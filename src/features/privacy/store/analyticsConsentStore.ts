import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { setReporterEnabled } from '../../../core/observability/reporter';
import { createConsentRecord, parseCurrentConsentRecord } from '../consentRecord';

const KEY = 'chathouse.consent.diagnostics.v2';

/**
 * Opt-in consent for crash + telemetry reporting. Persisted as a
 * purpose-specific, timestamped record tied to the current privacy-document
 * version. Legacy booleans deliberately fail closed and require a fresh opt-in.
 *
 * The reporter (Sentry) is gated by `setReporterEnabled` so disabling the
 * toggle stops outbound events immediately, not just from the next launch.
 */
interface AnalyticsConsentState {
  enabled: boolean;
  recordedAt: string | null;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (next: boolean) => Promise<void>;
}

export const useAnalyticsConsentStore = create<AnalyticsConsentState>((set, get) => ({
  enabled: false,
  recordedAt: null,
  isHydrated: false,

  hydrate: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const record = parseCurrentConsentRecord(raw, 'diagnostics');
      const enabled = record?.status === 'granted';
      set({ enabled, recordedAt: record?.recordedAt ?? null, isHydrated: true });
      setReporterEnabled(enabled);
    } catch {
      set({ enabled: false, recordedAt: null, isHydrated: true });
      setReporterEnabled(false);
    }
  },

  setEnabled: async next => {
    const record = createConsentRecord('diagnostics', next ? 'granted' : 'denied');
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
    set({ enabled: next, recordedAt: record.recordedAt });
    setReporterEnabled(next);
  },
}));
