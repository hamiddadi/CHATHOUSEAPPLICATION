import { apiClient } from '../../../shared/services/api/apiClient';

export interface ProfileLink {
  id: string;
  label: string;
  url: string;
  icon?: string | null;
}

export const profileLinksApi = {
  async list(userId: string): Promise<ProfileLink[]> {
    const { data } = await apiClient.get<{ items: ProfileLink[] }>(`/ext/profile-links/${userId}`);
    return data.items;
  },
  async add(input: { label: string; url: string; icon?: string | null }): Promise<ProfileLink[]> {
    const { data } = await apiClient.post<{ items: ProfileLink[] }>('/ext/profile-links/me', input);
    return data.items;
  },
  async update(
    linkId: string,
    patch: Partial<{ label: string; url: string; icon: string | null }>,
  ): Promise<ProfileLink[]> {
    const { data } = await apiClient.patch<{ items: ProfileLink[] }>(
      `/ext/profile-links/me/${linkId}`,
      patch,
    );
    return data.items;
  },
  async remove(linkId: string): Promise<ProfileLink[]> {
    const { data } = await apiClient.delete<{ items: ProfileLink[] }>(
      `/ext/profile-links/me/${linkId}`,
    );
    return data.items;
  },
};
