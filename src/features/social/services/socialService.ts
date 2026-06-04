import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { UserSummary } from '../../../shared/types/domain';

/**
 * Wrapper around the backend `/api/users/:id/wave|block|report` +
 * `/api/users/me/blocked` endpoints (Module 10).
 */

export type ReportReason = 'spam' | 'harassment' | 'fake_profile' | 'other';

interface RawBlockedUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

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
    // The backend `publicUser` select yields nullable username/displayName/
    // avatarUrl. Coalesce so the non-null `UserSummary` contract holds and a
    // null displayName doesn't render as a blank row.
    const res = await apiClient.get<Envelope<RawBlockedUser[]>>('/users/me/blocked');
    return res.data.data.map(u => ({
      id: u.id,
      username: u.username ?? '',
      displayName: u.displayName ?? u.username ?? '',
      avatarUrl: u.avatarUrl,
    }));
  },

  async report(userId: string, input: ReportInput): Promise<{ reportId: string }> {
    const res = await apiClient.post<Envelope<{ reportId: string }>>(
      `/users/${userId}/report`,
      input,
    );
    return res.data.data;
  },
};
