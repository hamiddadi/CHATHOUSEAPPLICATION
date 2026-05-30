import { apiClient } from '../../../shared/services/api/apiClient';

export interface RoomSearchResult {
  id: string;
  title: string;
  description: string | null;
  topic: string | null;
  topics: string[];
  isLive: boolean;
  scheduledFor: string | null;
  participantCount: number;
  host: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export interface RoomSearchFilter {
  q?: string;
  topic?: string;
  language?: string;
  liveOnly?: boolean;
  limit?: number;
}

export const searchExtApi = {
  async rooms(filter: RoomSearchFilter): Promise<RoomSearchResult[]> {
    const params: Record<string, string | number> = {};
    if (filter.q) params.q = filter.q;
    if (filter.topic) params.topic = filter.topic;
    if (filter.language) params.language = filter.language;
    if (filter.liveOnly !== undefined) params.liveOnly = String(filter.liveOnly);
    if (filter.limit) params.limit = filter.limit;
    const { data } = await apiClient.get<{ items: RoomSearchResult[] }>('/ext/search/rooms', {
      params,
    });
    return data.items;
  },
};
