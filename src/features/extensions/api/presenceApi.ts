import { apiClient } from '../../../shared/services/api/apiClient';

export interface AvailableUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  lastSeenAt: string | null;
  isOnline: boolean;
}

export const presenceApi = {
  async available(limit = 30): Promise<AvailableUser[]> {
    const { data } = await apiClient.get<{ items: AvailableUser[] }>('/ext/presence/available', {
      params: { limit },
    });
    return data.items;
  },
};
