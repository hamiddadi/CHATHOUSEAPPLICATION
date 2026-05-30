import { apiClient } from '../../../shared/services/api/apiClient';

export interface UpcomingEvent {
  id: string;
  title: string;
  description: string | null;
  scheduledFor: string | null;
  host: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  club: { id: string; name: string; iconUrl: string | null } | null;
  rsvpCount: number;
  rsvpedByMe: boolean;
}

export const upcomingApi = {
  /**
   * Uses the existing /api/rooms/me/upcoming endpoint (`myUpcomingEvents`)
   * — no extension route needed since the backend already exposes it.
   */
  async listMine(): Promise<UpcomingEvent[]> {
    const { data } = await apiClient.get<{ items: UpcomingEvent[] } | UpcomingEvent[]>(
      '/rooms/me/upcoming',
    );
    return Array.isArray(data) ? data : data.items;
  },
};
