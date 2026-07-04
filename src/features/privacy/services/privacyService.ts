import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';

// Grace window the backend applies before a soft-deleted account is purged
// (users.service DELETION_GRACE_MS = 30 days). The `me` payload only carries
// `deletedAt`; the permanent-deletion date is derived from it here.
const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeletionStatus {
  /** True when the account is soft-deleted and inside the grace window. */
  inGracePeriod: boolean;
  /** ISO timestamp the deletion was requested (null when not deleting). */
  deletedAt: string | null;
  /** ISO timestamp the account is permanently purged (null when not deleting). */
  permanentDeletionAt: string | null;
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

  /**
   * Reads the authoritative `/users/me` payload to tell whether the signed-in
   * account is in the 30-day RGPD deletion grace window. A soft-deleted account
   * still authenticates (auth.middleware lets it through precisely so it can
   * self-cancel), so the client checks `deletedAt` to offer restoration.
   */
  async getDeletionStatus(): Promise<DeletionStatus> {
    const res = await apiClient.get<Envelope<{ deletedAt?: string | null }>>('/users/me');
    const deletedAt = res.data.data.deletedAt ?? null;
    if (!deletedAt) {
      return { inGracePeriod: false, deletedAt: null, permanentDeletionAt: null };
    }
    const permanentDeletionAt = new Date(
      new Date(deletedAt).getTime() + DELETION_GRACE_MS,
    ).toISOString();
    return { inGracePeriod: true, deletedAt, permanentDeletionAt };
  },
};
