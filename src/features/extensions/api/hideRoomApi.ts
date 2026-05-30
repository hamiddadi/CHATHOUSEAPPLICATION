import { apiClient } from '../../../shared/services/api/apiClient';

export const hideRoomApi = {
  async list(): Promise<string[]> {
    const { data } = await apiClient.get<{ items: string[] }>('/ext/hide-room');
    return data.items;
  },
  async hide(roomId: string): Promise<void> {
    await apiClient.post(`/ext/hide-room/${roomId}`, {});
  },
  async unhide(roomId: string): Promise<void> {
    await apiClient.delete(`/ext/hide-room/${roomId}`);
  },
};
