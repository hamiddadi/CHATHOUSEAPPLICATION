import { useQuery } from '@tanstack/react-query';
import { topicsApi, type FlatTopic, type Topic } from '../api/topicsApi';

export const extTopicsTreeKey = ['ext', 'topics', 'tree'] as const;
export const extTopicsFlatKey = (q?: string, parent?: string | null) =>
  ['ext', 'topics', 'flat', q ?? '', parent ?? 'root'] as const;

export const useExtTopicsTree = () =>
  useQuery({
    queryKey: extTopicsTreeKey,
    queryFn: () => topicsApi.tree(),
    staleTime: 24 * 60 * 60 * 1000, // 1 day — static data
  });

export const useExtTopicsFlat = (q?: string, parent?: string | null) =>
  useQuery<FlatTopic[]>({
    queryKey: extTopicsFlatKey(q, parent),
    queryFn: () => topicsApi.flat({ q, parent: parent ?? undefined }),
    staleTime: 60_000,
  });

export type { Topic, FlatTopic };
