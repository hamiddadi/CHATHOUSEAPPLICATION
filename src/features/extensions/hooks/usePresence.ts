import { useQuery } from '@tanstack/react-query';
import { presenceApi } from '../api/presenceApi';

export const extPresenceKey = ['ext', 'presence', 'available'] as const;

export const useExtAvailablePeople = (limit = 30) =>
  useQuery({
    queryKey: [...extPresenceKey, limit],
    queryFn: () => presenceApi.available(limit),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
