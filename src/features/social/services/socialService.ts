import { apiClient } from '../../../shared/services/api/apiClient';
import type { UserSummary } from '../../../shared/types/domain';

/**
 * Wrapper around the backend `/api/users/:id/wave|block|report` +
 * `/api/users/me/blocked` endpoints (Module 10).
 */

interface Envelope<T> {
  success: true;
  data: T;
}

export type ReportReason = 'spam' | 'harassment' | 'fake_profile' | 'other';

export interface ReportInput {
  reason: ReportReason;
  details?: string;
}

export const socialService = {
  async wave(userId: string): Promise<{ waved: true }> {
    const res = await apiClient.post<Envelope<{ waved: true }>>(`/users/${userId}/wave`);
    return res.data.data;
  },

  async block(userId: string): Promise<{ blocked: true }> {
    const res = await apiClient.post<Envelope<{ blocked: true }>>(`/users/${userId}/block`);
    return res.data.data;
  },

  async unblock(userId: string): Promise<{ unblocked: true }> {
    const res = await apiClient.delete<Envelope<{ unblocked: true }>>(`/users/${userId}/block`);
    return res.data.data;
  },

  async listBlocked(): Promise<UserSummary[]> {
    const res = await apiClient.get<Envelope<UserSummary[]>>('/users/me/blocked');
    return res.data.data;
  },

  async report(userId: string, input: ReportInput): Promise<{ reportId: string }> {
    const res = await apiClient.post<Envelope<{ reportId: string }>>(
      `/users/${userId}/report`,
      input,
    );
    return res.data.data;
  },
};
