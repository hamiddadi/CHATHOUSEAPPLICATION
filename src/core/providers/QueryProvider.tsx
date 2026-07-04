import React from 'react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useNetworkStore } from '../../shared/services/network/networkStore';
import type { AppError } from '../../shared/services/api/errorHandler';

/**
 * Retry policy that only fires on *transient* failures.
 * - Network + timeout + 5xx → worth another shot
 * - 4xx (auth/forbidden/notFound/validation) → never retry
 */
const isAppError = (e: unknown): e is AppError =>
  typeof e === 'object' && e !== null && 'kind' in e;

const shouldRetryError = (err: unknown): boolean =>
  isAppError(err) && (err.kind === 'network' || err.kind === 'timeout' || err.kind === 'server');

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => count < 2 && shouldRetryError(err),
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // One retry on genuinely transient errors. Anything else (401/422/
        // 403/client bugs) is surfaced immediately to the UI via toast.
        retry: (count, err) => count < 1 && shouldRetryError(err),
      },
    },
  });

/**
 * Module-level singleton so non-React code can reach the cache: authStore's
 * signOut() purges it (`queryClient.clear()`) and the socket-reconnect
 * bootstrap (AppProviders) invalidates realtime-backed keys. The provider
 * mounts THIS instance, so hooks and imperative access share one cache.
 */
export const queryClient = createQueryClient();

// Drive TanStack's onlineManager from the NetInfo-fed network store (see
// startNetworkListener in core/App.tsx): paused queries resume and
// `refetchOnReconnect` fires when connectivity returns. Subscribing to the
// zustand store rather than NetInfo directly reuses the app's single NetInfo
// subscription and stays inert under jest (store defaults to online).
onlineManager.setEventListener(setOnline => {
  setOnline(useNetworkStore.getState().isOnline);
  return useNetworkStore.subscribe(state => setOnline(state.isOnline));
});

export const QueryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
