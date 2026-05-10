import React, { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AppError } from '../../shared/services/api/errorHandler';

/**
 * Retry policy that only fires on *transient* failures.
 * - Network + timeout + 5xx → worth another shot
 * - 4xx (auth/forbidden/notFound/validation) → never retry
 */
const shouldRetryError = (err: unknown): boolean => {
  const e = err as AppError | undefined;
  if (!e || typeof e !== 'object' || !('kind' in e)) return false;
  return e.kind === 'network' || e.kind === 'timeout' || e.kind === 'server';
};

export const QueryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const client = useMemo(
    () =>
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
      }),
    [],
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
