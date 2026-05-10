import { create } from 'zustand';

/**
 * Network connectivity state fed by `@react-native-community/netinfo` when
 * it's installed. The package is lazy-loaded at first subscription so the
 * app works in Expo Go even before the dep is added.
 *
 * To enable:
 *   expo install @react-native-community/netinfo
 * No other wiring — `useNetworkStatus()` auto-detects.
 */
interface NetworkState {
  isOnline: boolean;
  lastTransitionAt: number;
}

export const useNetworkStore = create<NetworkState>(() => ({
  isOnline: true,
  lastTransitionAt: Date.now(),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
type NetInfoLib = {
  addEventListener: (
    cb: (s: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void,
  ) => () => void;
  fetch: () => Promise<{ isConnected: boolean | null; isInternetReachable: boolean | null }>;
};

let loaded = false;
let netInfo: NetInfoLib | null = null;
let unsubscribe: (() => void) | null = null;

const loadNetInfo = (): NetInfoLib | null => {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return require('@react-native-community/netinfo').default as NetInfoLib;
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    return null;
  }
};

export const startNetworkListener = (): void => {
  if (loaded) return;
  loaded = true;
  netInfo = loadNetInfo();
  if (!netInfo) return;

  void netInfo.fetch().then(s => {
    const isOnline = Boolean(s.isConnected) && s.isInternetReachable !== false;
    useNetworkStore.setState({ isOnline, lastTransitionAt: Date.now() });
  });

  unsubscribe = netInfo.addEventListener(s => {
    const prev = useNetworkStore.getState().isOnline;
    const isOnline = Boolean(s.isConnected) && s.isInternetReachable !== false;
    if (prev !== isOnline) {
      useNetworkStore.setState({ isOnline, lastTransitionAt: Date.now() });
    }
  });
};

export const stopNetworkListener = (): void => {
  unsubscribe?.();
  unsubscribe = null;
  loaded = false;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
