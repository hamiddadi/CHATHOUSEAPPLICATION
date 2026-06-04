import { apiClient } from '../../../shared/services/api/apiClient';

export interface SuggestedUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followerCount: number;
  sharedInterestsCount: number;
  reason: 'shared_interests' | 'friends_of_friends' | 'trending';
}

export const suggestionsApi = {
  async list(limit = 20): Promise<SuggestedUser[]> {
    const { data } = await apiClient.get<{ items: SuggestedUser[] }>('/ext/suggestions', {
      params: { limit },
    });
    return data.items;
  },
};
