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
    const paths = ['/clubs/me', '/users/me/clubs', '/clubs?member=me'];
    for (const p of paths) {
      try {
        const { data } = await apiClient.get<{ items: ClubLite[] } | ClubLite[]>(p);
        return Array.isArray(data) ? data : data.items;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status && status !== 404 && status !== 405) throw err;
      }
    }
    return [];
  },
};
