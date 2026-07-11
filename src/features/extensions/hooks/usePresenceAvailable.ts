import { useQuery } from '@tanstack/react-query';
import { presenceApi } from '../api/presenceApi';

export const presenceAvailableKey = (limit: number) =>
  ['ext', 'presence', 'available', limit] as const;

/**
 * "Online now" people available to chat (see presenceApi.available). Polls on a
 * modest interval while mounted so the Messages strip reflects followed users
 * coming online / leaving without a manual refresh. Failures resolve to an empty
 * list (the strip simply hides — it is a non-critical accent, not a blocker).
 */
export const usePresenceAvailable = (limit = 20) =>
  useQuery({
    queryKey: presenceAvailableKey(limit),
    queryFn: () => presenceApi.available(limit),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
