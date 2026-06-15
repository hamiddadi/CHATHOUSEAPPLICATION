import { apiClient } from '../../../shared/services/api/apiClient';

export interface Topic {
  slug: string;
  label: string;
  emoji: string;
  children?: Topic[];
}

export interface FlatTopic {
  slug: string;
  label: string;
  emoji: string;
  parent: string | null;
}

export interface TrendingTopic {
  slug: string;
  label: string;
  emoji: string;
  count: number;
}

export const topicsApi = {
  async tree(): Promise<{ topics: Topic[]; total: number }> {
    const { data } = await apiClient.get<{ topics: Topic[]; total: number }>('/ext/topics');
    return data;
  },
  async flat(opts: { q?: string; parent?: string | null } = {}): Promise<FlatTopic[]> {
    const params: Record<string, string> = {};
    if (opts.q) params.q = opts.q;
    if (opts.parent !== undefined) params.parent = opts.parent === null ? 'null' : opts.parent;
    const { data } = await apiClient.get<{ items: FlatTopic[] }>('/ext/topics/flat', { params });
    return data.items;
  },
  async trending(): Promise<TrendingTopic[]> {
    const { data } = await apiClient.get<{ items: TrendingTopic[] }>('/ext/topics/trending');
    return data.items;
  },
};
