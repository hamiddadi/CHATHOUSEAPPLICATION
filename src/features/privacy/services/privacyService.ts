import { apiClient } from '../../../shared/services/api/apiClient';

interface Envelope<T> {
  success: true;
  data: T;
}

export const privacyService = {
  /**
   * Pull the full user-data archive as raw JSON. Returned as a string so
   * the caller can hand it off to the Share sheet or write to disk
   * without going through React Query.
   */
  async exportMyData(): Promise<string> {
    const res = await apiClient.get<string>('/users/me/export', {
      responseType: 'text',
      headers: { Accept: 'application/json' },
      // axios would parse JSON by default — force a passthrough so the
      // user sees the same bytes the server emits (incl. indentation).
      transformResponse: [d => d],
    });
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
  },

  async requestDeletion(): Promise<{ deletedAt: string; permanentDeletionAt: string }> {
    const res = await apiClient.post<Envelope<{ deletedAt: string; permanentDeletionAt: string }>>(
      '/users/me/request-deletion',
    );
    return res.data.data;
  },

  async cancelDeletion(): Promise<{ cancelled: true }> {
    const res = await apiClient.post<Envelope<{ cancelled: true }>>('/users/me/cancel-deletion');
    return res.data.data;
  },
};
