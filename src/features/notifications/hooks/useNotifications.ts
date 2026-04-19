import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '../services/notificationService';
import type { AppNotification } from '../../../shared/types/domain';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
};

export const useNotifications = () =>
  useQuery<AppNotification[]>({
    queryKey: notificationKeys.list(),
    queryFn: () => notificationService.list(),
  });

export const useMarkNotificationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationService.markAsRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.list() });
    },
  });
};

export const useMarkAllNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationService.markAllAsRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.list() });
    },
  });
};
