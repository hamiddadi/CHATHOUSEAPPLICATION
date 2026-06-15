import { useQuery } from '@tanstack/react-query';
import { topicsApi, type FlatTopic, type Topic, type TrendingTopic } from '../api/topicsApi';

export const extTopicsTreeKey = ['ext', 'topics', 'tree'] as const;
export const extTopicsFlatKey = (q?: string, parent?: string | null) =>
  // Three distinct semantics must not collide in the cache:
  // parent===null → roots only ('root'); parent===undefined → all topics ('all');
  // parent==='<slug>' → children of that slug.
  ['ext', 'topics', 'flat', q ?? '', parent === null ? 'root' : (parent ?? 'all')] as const;

export const useExtTopicsTree = () =>
  useQuery({
    queryKey: extTopicsTreeKey,
    queryFn: () => topicsApi.tree(),
    staleTime: 24 * 60 * 60 * 1000, // 1 day — static data
  });

export const useExtTopicsFlat = (q?: string, parent?: string | null) =>
  useQuery<FlatTopic[]>({
    queryKey: extTopicsFlatKey(q, parent),
    // Pass `parent` through verbatim — topicsApi.flat distinguishes null
    // (roots only) from undefined (all). Collapsing null→undefined here made
    // the root filter unreachable.
    queryFn: () => topicsApi.flat({ q, parent }),
    staleTime: 60_000,
  });

export const useExtTopicsTrending = () =>
  useQuery<TrendingTopic[]>({
    queryKey: ['ext', 'topics', 'trending'],
    queryFn: () => topicsApi.trending(),
    staleTime: 60_000,
  });

export type { Topic, FlatTopic, TrendingTopic };
