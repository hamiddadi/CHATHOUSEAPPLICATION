import { apiClient } from '../../../shared/services/api/apiClient';

export interface ClubMeta {
  coverUrl: string | null;
  featuredMembers: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  }[];
}

export const clubMetaApi = {
  async get(clubId: string): Promise<ClubMeta> {
    const { data } = await apiClient.get<ClubMeta>(`/ext/club-meta/${clubId}`);
    return data;
  },
  async setCover(clubId: string, coverUrl: string): Promise<ClubMeta> {
    const { data } = await apiClient.patch<ClubMeta>(`/ext/club-meta/${clubId}/cover`, {
      coverUrl,
    });
    return data;
  },
  async addFeatured(clubId: string, userId: string): Promise<ClubMeta> {
    const { data } = await apiClient.post<ClubMeta>(
      `/ext/club-meta/${clubId}/featured/${userId}`,
      {},
    );
    return data;
  },
  async removeFeatured(clubId: string, userId: string): Promise<ClubMeta> {
    const { data } = await apiClient.delete<ClubMeta>(
      `/ext/club-meta/${clubId}/featured/${userId}`,
    );
    return data;
  },
};
