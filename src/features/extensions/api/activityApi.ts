import { apiClient } from '../../../shared/services/api/apiClient';

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  targetId: string | null;
  targetType: string | null;
  actor: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  isRead: boolean;
  createdAt: string;
}

export const activityApi = {
  /**
   * Fetches the user's notification feed. Reuses the existing
   * `/api/notifications` endpoint — no new backend needed. The response
   * is normalized into the `ActivityItem` shape; both `{ items }` and bare
   * arrays are accepted.
   */
  async list(filter: 'all' | 'rooms' | 'social' | 'clubs' = 'all'): Promise<ActivityItem[]> {
    const { data } = await apiClient.get<{ items: ActivityItem[] } | ActivityItem[]>(
      '/notifications',
      { params: { filter } },
    );
    return Array.isArray(data) ? data : data.items;
  },
  async markRead(id: string): Promise<void> {
    await apiClient.post(`/notifications/${id}/read`, {});
  },
  async markAllRead(): Promise<void> {
    await apiClient.post('/notifications/read-all', {});
  },
};
