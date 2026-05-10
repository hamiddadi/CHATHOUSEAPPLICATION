import { useQuery } from '@tanstack/react-query';
import { searchService, type SearchResults } from '../services/searchService';
import { exploreService, type ExploreFeed } from '../services/exploreService';

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => [...searchKeys.all, 'query', q] as const,
  explore: () => ['explore'] as const,
};

/**
 * Debounce-free: TanStack's `enabled: q.length > 0` combined with the
 * caller's own debounce (typical 200ms) keeps this cheap while the user
 * is typing.
 */
export const useSearch = (q: string) =>
  useQuery<SearchResults>({
    queryKey: searchKeys.query(q),
    queryFn: () => searchService.search(q),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  });

export const useExplore = () =>
  useQuery<ExploreFeed>({
    queryKey: searchKeys.explore(),
    queryFn: () => exploreService.feed(),
    staleTime: 60_000,
  });
