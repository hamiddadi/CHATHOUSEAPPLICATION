import { apiClient } from '../../../shared/services/api/apiClient';

export type FrequencyTier = 'infrequent' | 'normal' | 'frequent';

export interface NotifPrefsExt {
  frequency: FrequencyTier;
  mutedClubs: string[];
  mutedUsers: string[];
}

export const notifPrefsExtApi = {
  async get(): Promise<NotifPrefsExt> {
    const { data } = await apiClient.get<NotifPrefsExt>('/ext/notif-prefs');
    return data;
  },
  async setFrequency(frequency: FrequencyTier): Promise<{ frequency: FrequencyTier }> {
    const { data } = await apiClient.patch<{ frequency: FrequencyTier }>(
      '/ext/notif-prefs/frequency',
      { frequency },
    );
    return data;
  },
  async muteClub(clubId: string): Promise<void> {
    await apiClient.post(`/ext/notif-prefs/clubs/${clubId}/mute`, {});
  },
  async unmuteClub(clubId: string): Promise<void> {
    await apiClient.delete(`/ext/notif-prefs/clubs/${clubId}/mute`);
  },
  async muteUser(userId: string): Promise<void> {
    await apiClient.post(`/ext/notif-prefs/users/${userId}/mute`, {});
  },
  async unmuteUser(userId: string): Promise<void> {
    await apiClient.delete(`/ext/notif-prefs/users/${userId}/mute`);
  },
};
