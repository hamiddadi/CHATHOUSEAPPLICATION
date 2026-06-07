import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import type { AppNotification } from '@/shared/types/domain';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useRemoveNotification,
} from '../../hooks/useNotifications';
import { NotificationsScreen } from './NotificationsScreen';

jest.mock('../../hooks/useNotifications', () => ({
  useNotifications: jest.fn(),
  useMarkNotificationRead: jest.fn(),
  useMarkAllNotificationsRead: jest.fn(),
  useRemoveNotification: jest.fn(),
}));

const mockUseNotifications = useNotifications as jest.Mock;
const mockUseMarkOne = useMarkNotificationRead as jest.Mock;
const mockUseMarkAll = useMarkAllNotificationsRead as jest.Mock;
const mockUseRemove = useRemoveNotification as jest.Mock;

type QueryOver = Partial<{
  data: AppNotification[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  refetch: jest.Mock;
}>;

const queryState = (over: QueryOver = {}) => ({
  data: undefined as AppNotification[] | undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  ...over,
});

const mutationState = () => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
});

const makeNotification = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1',
  kind: 'follow',
  actor: { id: 'u1', username: 'jane', displayName: 'Jane Doe', avatarUrl: null },
  message: 'Jane Doe started following you',
  roomId: null,
  houseId: null,
  createdAt: '2024-01-31T13:05:00.000Z',
  isRead: false,
  ...over,
});

let markOne: ReturnType<typeof mutationState>;
let markAll: ReturnType<typeof mutationState>;
let remove: ReturnType<typeof mutationState>;

beforeEach(() => {
  mockUseNotifications.mockReset();
  mockUseMarkOne.mockReset();
  mockUseMarkAll.mockReset();
  mockUseRemove.mockReset();

  markOne = mutationState();
  markAll = mutationState();
  remove = mutationState();

  mockUseMarkOne.mockReturnValue(markOne);
  mockUseMarkAll.mockReturnValue(markAll);
  mockUseRemove.mockReturnValue(remove);
  mockUseNotifications.mockReturnValue(queryState());
});

describe('NotificationsScreen', () => {
  it('renders the header title and filter tabs', () => {
    mockUseNotifications.mockReturnValue(queryState({ data: [] }));
    renderScreen(<NotificationsScreen />);

    expect(screen.getByText(i18n.t('notifications.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('notifications.tabs.all'))).toBeTruthy();
    expect(screen.getByText(i18n.t('notifications.tabs.rooms'))).toBeTruthy();
  });

  it('shows the loader while loading', () => {
    mockUseNotifications.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<NotificationsScreen />);

    expect(screen.getByLabelText(i18n.t('notifications.title'))).toBeTruthy();
  });

  it('shows the empty state when there are no notifications', () => {
    mockUseNotifications.mockReturnValue(queryState({ data: [] }));
    renderScreen(<NotificationsScreen />);

    expect(screen.getByText(i18n.t('notifications.empty'))).toBeTruthy();
  });

  it('renders a loaded notification and the mark-all action when unread', () => {
    mockUseNotifications.mockReturnValue(queryState({ data: [makeNotification()] }));
    renderScreen(<NotificationsScreen />);

    expect(screen.getByText('Jane Doe started following you')).toBeTruthy();
    expect(screen.getByText(i18n.t('notifications.markAllRead'))).toBeTruthy();
  });

  it('marks one as read and deep-links to the actor profile on row press', async () => {
    const notif = makeNotification();
    mockUseNotifications.mockReturnValue(queryState({ data: [notif] }));
    const { navigation } = renderScreen(<NotificationsScreen />);

    fireEvent.press(screen.getByText('Jane Doe started following you'));

    await waitFor(() => {
      expect(markOne.mutate).toHaveBeenCalledWith('n1');
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Profile', { userId: 'u1' });
  });

  it('marks all as read when the mark-all button is pressed', () => {
    mockUseNotifications.mockReturnValue(queryState({ data: [makeNotification()] }));
    renderScreen(<NotificationsScreen />);

    fireEvent.press(screen.getByText(i18n.t('notifications.markAllRead')));

    expect(markAll.mutate).toHaveBeenCalledTimes(1);
  });
});
