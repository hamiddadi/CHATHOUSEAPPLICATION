import { apiClient } from '../../../shared/services/api/apiClient';

export interface PrivacySettings {
  isPrivateAccount: boolean;
  allowWaves: boolean;
  isVisibleOnMap: boolean;
}

export const privacyApi = {
  async get(): Promise<PrivacySettings> {
    const { data } = await apiClient.get<PrivacySettings>('/ext/privacy');
    return data;
  },
  async update(patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    const { data } = await apiClient.patch<PrivacySettings>('/ext/privacy', patch);
    return data;
  },
};
