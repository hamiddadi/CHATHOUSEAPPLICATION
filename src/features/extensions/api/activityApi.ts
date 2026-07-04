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
   *
   * `cursor` is the `createdAt` ISO timestamp of the last item already loaded;
   * the backend returns rows strictly older than it (keyset pagination). The
   * REST surface returns the array directly (no `nextCursor` in the body), so
   * the caller derives the next cursor from the last row's `createdAt`.
   */
  async list(
    filter: 'all' | 'rooms' | 'social' | 'clubs' = 'all',
    cursor?: string,
  ): Promise<ActivityItem[]> {
    const { data } = await apiClient.get<unknown>('/notifications', {
      params: { filter, ...(cursor ? { cursor } : {}) },
    });
    // The backend wraps responses in the `sendOk` envelope ({ success, data }).
    // Tolerate every shape we might receive without ever returning undefined:
    // bare array, { items }, the envelope, or a paginated { data: [...] } body.
    const unwrapArray = (v: unknown): ActivityItem[] => {
      if (Array.isArray(v)) return v as ActivityItem[];
      if (v && typeof v === 'object') {
        const o = v as { data?: unknown; items?: unknown };
        if (Array.isArray(o.data)) return o.data as ActivityItem[];
        if (Array.isArray(o.items)) return o.items as ActivityItem[];
        if (o.data && typeof o.data === 'object') return unwrapArray(o.data);
      }
      return [];
    };
    return unwrapArray(data);
  },
  async markRead(id: string): Promise<void> {
    // Backend exposes PATCH (not POST) for these routes — a POST 404s.
    await apiClient.patch(`/notifications/${id}/read`, {});
  },
  async markAllRead(): Promise<void> {
    await apiClient.patch('/notifications/read-all', {});
  },
};
