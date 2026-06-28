import { apiClient } from '../../../shared/services/api/apiClient';

export interface ClubJoinRequest {
  clubId: string;
  userId: string;
  message: string | null;
  createdAt: string;
  /**
   * Outcome discriminator returned by the backend on POST /request:
   *   - 'joined'  : OPEN club — the caller is now a member (no approval needed)
   *   - 'pending' : SOCIAL club — an admin must approve the request
   * Optional so older callers (and the admin `list()` payload, which omits it)
   * keep type-checking. PRIVATE clubs reject the request entirely (CLUB_003).
   */
  status?: 'joined' | 'pending';
  /**
   * Requester identity, present on the admin `list()` payload so the approval
   * UI can show a name/avatar instead of the raw `userId`. Absent from the
   * `request()` response (the requester already knows who they are).
   */
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export const clubReqApi = {
  async request(clubId: string, message?: string): Promise<ClubJoinRequest> {
    const { data } = await apiClient.post<ClubJoinRequest>(`/ext/clubreq/${clubId}/request`, {
      message,
    });
    return data;
  },
  async list(clubId: string): Promise<ClubJoinRequest[]> {
    const { data } = await apiClient.get<{ items: ClubJoinRequest[] }>(
      `/ext/clubreq/${clubId}/requests`,
    );
    return data.items;
  },
  async approve(clubId: string, userId: string): Promise<{ approved: boolean }> {
    const { data } = await apiClient.post<{ approved: boolean }>(
      `/ext/clubreq/${clubId}/requests/${userId}/approve`,
      {},
    );
    return data;
  },
  async decline(clubId: string, userId: string): Promise<{ declined: boolean }> {
    const { data } = await apiClient.post<{ declined: boolean }>(
      `/ext/clubreq/${clubId}/requests/${userId}/decline`,
      {},
    );
    return data;
  },
};
