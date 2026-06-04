import { apiClient } from '../../../shared/services/api/apiClient';

export interface CancelResult {
  canceled: boolean;
  notified: number;
}

export const eventsApi = {
  async cancel(roomId: string, reason?: string): Promise<CancelResult> {
    const { data } = await apiClient.post<CancelResult>(`/ext/events/${roomId}/cancel`, {
      reason,
    });
    return data;
  },
};
