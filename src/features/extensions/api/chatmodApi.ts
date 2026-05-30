import { apiClient } from '../../../shared/services/api/apiClient';

export const chatmodApi = {
  async deleteMessage(messageId: string): Promise<{ id: string; alreadyDeleted: boolean }> {
    const { data } = await apiClient.delete<{ id: string; alreadyDeleted: boolean }>(
      `/ext/chatmod/messages/${messageId}`,
    );
    return data;
  },
};
