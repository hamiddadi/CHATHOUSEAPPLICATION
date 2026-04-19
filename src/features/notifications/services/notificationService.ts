import { MOCK_NOTIFICATIONS } from '../../../shared/mocks/notifications.mock';
import type { AppNotification } from '../../../shared/types/domain';

const wait = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

export const notificationService = {
  async list(): Promise<AppNotification[]> {
    await wait(200);
    return [...MOCK_NOTIFICATIONS];
  },

  async markAsRead(notificationId: string): Promise<{ read: true }> {
    await wait(80);
    if (!MOCK_NOTIFICATIONS.find(n => n.id === notificationId)) {
      throw new Error(`Notification ${notificationId} not found`);
    }
    return { read: true };
  },

  async markAllAsRead(): Promise<{ read: number }> {
    await wait(120);
    return { read: MOCK_NOTIFICATIONS.filter(n => !n.isRead).length };
  },
};
