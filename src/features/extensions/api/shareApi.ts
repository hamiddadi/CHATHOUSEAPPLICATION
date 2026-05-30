import { apiClient } from '../../../shared/services/api/apiClient';

export interface ShareLinks {
  url: string;
  text: string;
  twitter: string;
  whatsapp: string;
  telegram: string;
}

export const shareApi = {
  async forRoom(roomId: string): Promise<ShareLinks> {
    const { data } = await apiClient.get<ShareLinks>(`/ext/share/rooms/${roomId}`);
    return data;
  },
};
