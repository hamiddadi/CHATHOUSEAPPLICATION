import { apiClient } from '../../../shared/services/api/apiClient';

export interface RecentRoom {
  id: string;
  title: string;
  isLive: boolean;
  scheduledFor: string | null;
  endedAt: string | null;
  topic: string | null;
  participantCount: number;
  host: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export const recentlyPlayedApi = {
  async list(limit = 20): Promise<RecentRoom[]> {
    const { data } = await apiClient.get<{ items: RecentRoom[] }>('/ext/recently-played', {
      params: { limit },
    });
    return data.items;
  },
  async touch(roomId: string): Promise<void> {
    await apiClient.post(`/ext/recently-played/${roomId}/touch`, {});
  },
};
