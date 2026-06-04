import { useEffect, useState } from 'react';
import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * Probes whether the running backend has the extension layer mounted.
 *
 * Useful when the mobile app might point at either the **legacy** entry
 * (`backend/src/app.ts`) or the **extended** one
 * (`backend/src/extensions/server.ts`). Components can gate themselves on
 * `available === true` to avoid rendering extension UI that would only
 * surface 404s.
 *
 * The probe hits `GET /api/ext/health`. The endpoint is intentionally
 * unauthenticated so we can detect availability before the user has a
 * session. The legacy notFoundHandler returns 404 → `available = false`.
 */

export interface ExtBackendStatus {
  available: boolean;
  vaguesMounted: string[];
  features: {
    payments: boolean;
    captions: boolean;
    twitter: boolean;
    contacts: boolean;
  };
}

const DEFAULT_STATUS: ExtBackendStatus = {
  available: false,
  vaguesMounted: [],
  features: { payments: false, captions: false, twitter: false, contacts: false },
};

export const useExtBackend = (): { status: ExtBackendStatus; loading: boolean } => {
  const [status, setStatus] = useState<ExtBackendStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const probe = async (): Promise<void> => {
      try {
        const { data } = await apiClient.get<ExtBackendStatus>('/ext/health');
        if (!cancelled) setStatus({ ...DEFAULT_STATUS, ...data, available: true });
      } catch {
        if (!cancelled) setStatus(DEFAULT_STATUS);
      } finally {
        if (!cancelled) setLoading(false);
        // Re-probe every 5 min so we recover if a sidecar comes online
        if (!cancelled) timer = setTimeout(() => void probe(), 5 * 60_000);
      }
    };

    void probe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { status, loading };
};
