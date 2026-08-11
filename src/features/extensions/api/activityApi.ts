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

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

export const activityApi = {
  /**
   * Fetches the user's notification feed. Reuses the existing
   * `/api/notifications` endpoint — no new backend needed. The response
   * is normalized into an `ActivityPage`; legacy arrays and nested page
   * envelopes are still accepted during rolling deployments.
   *
   * New cursors are opaque `(createdAt,id)` values. An older backend may still
   * omit metadata; in that case a full page falls back to its legacy ISO cursor.
   */
  async list(
    filter: 'all' | 'rooms' | 'social' | 'clubs' = 'all',
    cursor?: string,
  ): Promise<ActivityPage> {
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
    const items = unwrapArray(data);
    const root = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    const payload = root?.data;
    const nested =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const rawHasMore = root?.hasMore ?? nested?.hasMore;
    const hasMore = typeof rawHasMore === 'boolean' ? rawHasMore : items.length >= PAGE_SIZE;
    const rawNextCursor = root?.nextCursor ?? nested?.nextCursor;
    const legacyCursor = hasMore ? (items[items.length - 1]?.createdAt ?? null) : null;
    const nextCursor =
      typeof rawNextCursor === 'string'
        ? rawNextCursor
        : rawNextCursor === null
          ? null
          : legacyCursor;
    return { items, nextCursor, hasMore };
  },
  async markRead(id: string): Promise<void> {
    // Backend exposes PATCH (not POST) for these routes — a POST 404s.
    await apiClient.patch(`/notifications/${id}/read`, {});
  },
  async markAllRead(): Promise<void> {
    await apiClient.patch('/notifications/read-all', {});
  },
};
