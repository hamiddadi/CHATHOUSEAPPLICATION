import { apiClient } from '../../../shared/services/api/apiClient';

export type HandRaiseRestriction = 'everyone' | 'followers' | 'none';

export interface ExtRoomSettings {
  handRaiseRestriction: HandRaiseRestriction;
  coHostIds: string[];
}

export const roomSettingsExtApi = {
  async get(roomId: string): Promise<ExtRoomSettings> {
    const { data } = await apiClient.get<ExtRoomSettings>(`/ext/room-settings/${roomId}`);
    return data;
  },
  async setHandRaise(roomId: string, restriction: HandRaiseRestriction): Promise<ExtRoomSettings> {
    const { data } = await apiClient.patch<ExtRoomSettings>(
      `/ext/room-settings/${roomId}/hand-raise`,
      { restriction },
    );
    return data;
  },
  async addCoHost(roomId: string, userId: string): Promise<ExtRoomSettings> {
    const { data } = await apiClient.post<ExtRoomSettings>(
      `/ext/room-settings/${roomId}/co-hosts/${userId}`,
      {},
    );
    return data;
  },
  async removeCoHost(roomId: string, userId: string): Promise<ExtRoomSettings> {
    const { data } = await apiClient.delete<ExtRoomSettings>(
      `/ext/room-settings/${roomId}/co-hosts/${userId}`,
    );
    return data;
  },
};
