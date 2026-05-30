import { apiClient } from '../../../shared/services/api/apiClient';

export interface ClubLite {
  id: string;
  name: string;
  iconUrl: string | null;
  privacy: 'OPEN' | 'SOCIAL' | 'PRIVATE';
  memberCount: number;
  isMember?: boolean;
}

export const clubsListApi = {
  /**
   * Lists clubs the current user belongs to. Used by the ClubPickerSheet
   * when starting a Club-scoped room (Module 4.7 / ROOM-CREATE-012).
   * Reuses existing `/clubs/me` route — falls back to `/users/me/clubs`.
   */
  async myClubs(): Promise<ClubLite[]> {
    // `filter=mine` is the param the backend actually honours (listClubsSchema);
    // the other two paths are tolerated fallbacks for older deployments.
    const paths = ['/clubs/me', '/users/me/clubs', '/clubs?filter=mine'];
    for (const p of paths) {
      try {
        const { data } = await apiClient.get<unknown>(p);
        // sendOk wraps in { success, data }; also tolerate { items } and a bare
        // array. NEVER return undefined — a non-array 200 just moves to the next
        // path rather than poisoning the caller (the sheet spreads this value).
        const payload = Array.isArray(data)
          ? data
          : ((data as { data?: ClubLite[]; items?: ClubLite[] })?.data ??
            (data as { items?: ClubLite[] })?.items);
        if (Array.isArray(payload)) return payload;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status && status !== 404 && status !== 405) throw err;
      }
    }
    return [];
  },
};
