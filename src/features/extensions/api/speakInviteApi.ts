import { apiClient } from '../../../shared/services/api/apiClient';

export const speakInviteApi = {
  async invite(roomId: string, userId: string): Promise<{ invited: true }> {
    const { data } = await apiClient.post<{ invited: true }>(
      `/ext/speak-invite/${roomId}/invite/${userId}`,
      {},
    );
    return data;
  },
  async respond(roomId: string, accepted: boolean): Promise<{ accepted: boolean }> {
    const { data } = await apiClient.post<{ accepted: boolean }>(
      `/ext/speak-invite/${roomId}/respond`,
      { accepted },
    );
    return data;
  },
  async promote(roomId: string, userId: string): Promise<{ promoted: true }> {
    const { data } = await apiClient.post<{ promoted: true }>(
      `/ext/speak-invite/${roomId}/promote/${userId}`,
      {},
    );
    return data;
  },
};
