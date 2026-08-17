import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import { mapAuthUser } from '../../auth/services/authService';
import type { AuthSession, AuthUser } from '../../auth/types/auth.types';

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
   *
   * The API produces bounded, chunked output, but React Native Axios still
   * buffers `responseType: text` on the device. A future native direct-to-file
   * transport can remove that client-side limit without changing this API URL.
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

  async cancelDeletion(): Promise<{
    cancelled: true;
    session: AuthSession;
    user: AuthUser;
  }> {
    const res = await apiClient.post<
      Envelope<{
        cancelled: true;
        session: AuthSession;
        user: Parameters<typeof mapAuthUser>[0];
      }>
    >('/users/me/cancel-deletion');
    return { ...res.data.data, user: mapAuthUser(res.data.data.user) };
  },

  /**
   * Reads the authoritative `/users/me` payload to tell whether the signed-in
   * account is in its configured deletion grace window. This call is one of
   * the narrow surfaces accepted by the signed recovery-only session.
   */
  async getDeletionStatus(): Promise<DeletionStatus> {
    const res = await apiClient.get<
      Envelope<{
        deletedAt?: string | null;
        permanentDeletionAt?: string | null;
      }>
    >('/users/me');
    const deletedAt = res.data.data.deletedAt ?? null;
    if (!deletedAt) {
      return { inGracePeriod: false, deletedAt: null, permanentDeletionAt: null };
    }
    const permanentDeletionAt = res.data.data.permanentDeletionAt ?? null;
    return { inGracePeriod: true, deletedAt, permanentDeletionAt };
  },
};
