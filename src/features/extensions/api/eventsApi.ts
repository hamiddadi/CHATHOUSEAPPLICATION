import { apiClient } from '../../../shared/services/api/apiClient';

export interface CancelResult {
  canceled: boolean;
  notified: number;
}

export interface RescheduleResult {
  rescheduled: boolean;
  scheduledFor: string;
}

export const eventsApi = {
  async cancel(roomId: string, reason?: string): Promise<CancelResult> {
    const { data } = await apiClient.post<CancelResult>(`/ext/events/${roomId}/cancel`, {
      reason,
    });
    return data;
  },

  async reschedule(
    roomId: string,
    scheduledFor: string,
    title?: string,
  ): Promise<RescheduleResult> {
    const { data } = await apiClient.patch<RescheduleResult>(`/ext/events/${roomId}/reschedule`, {
      scheduledFor,
      title,
    });
    return data;
  },
};
