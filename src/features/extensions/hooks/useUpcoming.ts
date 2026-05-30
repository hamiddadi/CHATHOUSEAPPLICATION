import { useQuery } from '@tanstack/react-query';
import { upcomingApi, type UpcomingEvent } from '../api/upcomingApi';
import { privacyApi, type PrivacySettings } from '../api/privacyApi';
import { searchExtApi, type RoomSearchResult, type RoomSearchFilter } from '../api/searchExtApi';

export const extUpcomingKey = ['ext', 'upcoming', 'mine'] as const;
export const useExtUpcoming = () =>
  useQuery<UpcomingEvent[]>({
    queryKey: extUpcomingKey,
    queryFn: () => upcomingApi.listMine(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

export const extPrivacyKey = ['ext', 'privacy'] as const;
export const useExtPrivacy = () =>
  useQuery<PrivacySettings>({
    queryKey: extPrivacyKey,
    queryFn: () => privacyApi.get(),
    staleTime: 60_000,
  });

// Use a normalised object literal (not JSON.stringify) as the cache key:
// React Query hashes objects deterministically regardless of key order, so
// two logically-identical filters share a cache entry even if their property
// order or `undefined` fields differ. Explicit defaults keep the hash stable.
export const extSearchRoomsKey = (f: RoomSearchFilter) =>
  [
    'ext',
    'search',
    'rooms',
    {
      q: f.q ?? '',
      topic: f.topic ?? null,
      language: f.language ?? null,
      liveOnly: f.liveOnly ?? null,
      limit: f.limit ?? null,
    },
  ] as const;
export const useExtSearchRooms = (filter: RoomSearchFilter, enabled = true) =>
  useQuery<RoomSearchResult[]>({
    queryKey: extSearchRoomsKey(filter),
    queryFn: () => searchExtApi.rooms(filter),
    enabled,
    staleTime: 15_000,
  });
