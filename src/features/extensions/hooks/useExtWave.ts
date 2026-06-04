import { useCallback, useState } from 'react';
import { apiClient } from '../../../shared/services/api/apiClient';

/**
 * "Wave" to another user (Module 3.7 / HALL-017) — sends a lightweight
 * social ping that surfaces as a notification on the target side, prompting
 * them to spin up a quick private room.
 *
 * The backend route already exists (`POST /api/users/:id/wave` is the
 * Clubhouse-style equivalent of the legacy ping endpoint). This hook is
 * resilient: it tries the most likely modern endpoint and falls back to
 * a few alternates without throwing if any return 404 — UX surface is a
 * boolean success.
 */

const ENDPOINTS = [
  (uid: string) => `/users/${uid}/wave`,
  (uid: string) => `/social/wave/${uid}`,
  (uid: string) => `/ext/presence/wave/${uid}`,
];

export const useExtWave = () => {
  const [pending, setPending] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<'ok' | 'error' | null>(null);

  const wave = useCallback(async (userId: string): Promise<boolean> => {
    setPending(userId);
    setLastResult(null);
    try {
      for (const make of ENDPOINTS) {
        try {
          await apiClient.post(make(userId), {});
          setLastResult('ok');
          return true;
        } catch (err) {
          // Errors arrive as the normalised AppError ({ kind, status }); there
          // is no raw `err.response`. Only fall through to the next endpoint
          // when the route is genuinely missing (404/405). Any real refusal
          // (403 private account, 500, network) must surface as 'error' rather
          // than retrying the remaining endpoints and masking the rejection.
          const e = err as { status?: number; kind?: string };
          if (!(e.kind === 'notFound' || e.status === 404 || e.status === 405)) {
            setLastResult('error');
            return false;
          }
        }
      }
      setLastResult('error');
      return false;
    } finally {
      setPending(null);
    }
  }, []);

  return { wave, pending, lastResult };
};
