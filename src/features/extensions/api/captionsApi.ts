import { apiClient } from '../../../shared/services/api/apiClient';

export const captionsApi = {
  async status(): Promise<{ configured: boolean }> {
    const { data } = await apiClient.get<{ configured: boolean }>('/ext/captions/status');
    return data;
  },
  async isEnabled(roomId: string): Promise<boolean> {
    const { data } = await apiClient.get<{ enabled: boolean }>(`/ext/captions/${roomId}`);
    return data.enabled;
  },
  async setEnabled(roomId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    const { data } = await apiClient.post<{ enabled: boolean }>(`/ext/captions/${roomId}`, {
      enabled,
    });
    return data;
  },
};
