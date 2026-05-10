import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationService, type NotificationFilter } from '../services/notificationService';
import type { AppNotification } from '../../../shared/types/domain';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (filter: NotificationFilter = 'all') => [...notificationKeys.all, 'list', filter] as const,
  unread: () => [...notificationKeys.all, 'unread'] as const,
};

export const useNotifications = (filter: NotificationFilter = 'all') =>
  useQuery<AppNotification[]>({
    queryKey: notificationKeys.list(filter),
    queryFn: () => notificationService.list(filter),
  });

export const useUnreadNotificationCount = () =>
  useQuery<number>({
    queryKey: notificationKeys.unread(),
    queryFn: () => notificationService.unreadCount(),
    // The tab-bar badge refreshes often; 30s staleTime keeps the request
    // cheap without feeling stale.
    staleTime: 30_000,
  });

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => {
  // `notificationKeys.all` is the tuple prefix shared by every list
  // variant (all/rooms/social/clubs) + the unread count, so one call
  // re-fetches every cached notification query.
  void qc.invalidateQueries({ queryKey: notificationKeys.all });
};

export const useMarkNotificationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationService.markAsRead(id),
    onSuccess: () => invalidateAll(qc),
  });
};

export const useMarkAllNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationService.markAllAsRead(),
    onSuccess: () => invalidateAll(qc),
  });
};

export const useRemoveNotification = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationService.remove(id),
    onSuccess: () => invalidateAll(qc),
  });
};
