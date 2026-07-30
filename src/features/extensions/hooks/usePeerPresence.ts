import { useQuery } from '@tanstack/react-query';
import { presenceApi } from '../api/presenceApi';

export const peerPresenceKey = (peerId: string) => ['ext', 'presence', 'peer', peerId] as const;

/** Privacy-filtered, periodically refreshed presence for one conversation peer. */
export const usePeerPresence = (peerId: string) =>
  useQuery({
    queryKey: peerPresenceKey(peerId),
    queryFn: () => presenceApi.peer(peerId),
    enabled: peerId.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
