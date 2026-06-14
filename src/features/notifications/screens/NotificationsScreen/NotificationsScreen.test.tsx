/**
 * Render-test for NotificationsScreen. Mounts the populated list (data primed
 * via seedQueryData against `notificationKeys.list('all')`) and exercises the
 * header back, "Mark all as read", the filter tab pills, and tapping a
 * notification row (which deep-links per kind). Also covers the empty state and
 * the loader. Native modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { notificationKeys } from '../../hooks/useNotifications';
import type { AppNotification, NotificationKind } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { NotificationsScreen } from './NotificationsScreen';

const makeNotif = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: 'notif-1',
  kind: 'follow' as NotificationKind,
  actor: { id: 'actor-1', username: 'someone', displayName: 'Some One', avatarUrl: null },
  message: 'Some One started following you.',
  roomId: null,
  houseId: null,
  createdAt: new Date('2024-03-01T00:00:00.000Z').toISOString(),
  isRead: false,
  ...overrides,
});

const seedNotifs = (notifs: AppNotification[]) => [
  { key: [...notificationKeys.list('all')], data: notifs },
];

describe('NotificationsScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with the title and the four filter tabs', () => {
    const { getByText, toJSON } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([makeNotif()]),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Notifications')).toBeTruthy();
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Rooms')).toBeTruthy();
    expect(getByText('Social')).toBeTruthy();
    expect(getByText('Clubs')).toBeTruthy();
  });

  it('renders the primed notification row', () => {
    const { getByText } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([makeNotif()]),
    });
    expect(getByText('Some One started following you.')).toBeTruthy();
  });

  it('shows the empty state when there are no notifications', () => {
    const { getByText } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([]),
    });
    expect(getByText("You're all caught up.")).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const { getAllByRole, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([makeNotif()]),
    });
    // The back chevron is the first button in the header.
    fireEvent.press(getAllByRole('button')[0]);
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('"Mark all as read" fires the mutation without throwing (unread present)', () => {
    const { getByText } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([makeNotif({ isRead: false })]),
    });
    // unreadCount > 0 so the action is rendered.
    expect(() => fireEvent.press(getByText('Mark all as read'))).not.toThrow();
  });

  it('switching to the "Rooms" tab does not crash and shows its (empty) list', () => {
    const { getByText } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      // Seed the 'rooms' filter key with [] so its query resolves empty (an
      // unseeded query stays pending → loader, never the empty state).
      seedQueryData: [
        ...seedNotifs([makeNotif()]),
        { key: [...notificationKeys.list('rooms')], data: [] },
      ],
    });
    fireEvent.press(getByText('Rooms'));
    expect(getByText("You're all caught up.")).toBeTruthy();
  });

  it('tapping a follow notification deep-links to the actor Profile', async () => {
    const { getByText, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([
        makeNotif({
          kind: 'follow',
          actor: { id: 'actor-9', username: 'x', displayName: 'X', avatarUrl: null },
        }),
      ]),
    });
    fireEvent.press(getByText('Some One started following you.'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('Profile', { userId: 'actor-9' }),
    );
  });

  it('tapping a room_starting notification deep-links to the Room', async () => {
    const { getByText, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([
        makeNotif({
          id: 'notif-room',
          kind: 'room_starting',
          roomId: 'room-7',
          message: 'A room is starting.',
        }),
      ]),
    });
    fireEvent.press(getByText('A room is starting.'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'room-7' }),
    );
  });

  it('tapping a house_invite notification deep-links to the HouseDetail', async () => {
    const { getByText, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([
        makeNotif({
          id: 'notif-house',
          kind: 'house_invite',
          houseId: 'house-3',
          message: 'You were invited to a House.',
        }),
      ]),
    });
    fireEvent.press(getByText('You were invited to a House.'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('HouseDetail', { houseId: 'house-3' }),
    );
  });

  it('renders the loader while the query is pending (no seed, authed)', () => {
    const { getByLabelText } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
    });
    // No seeded data → useQuery is pending (queryFn hits the unmocked network
    // but retry is disabled) → isLoading true on first render → Loader.
    expect(getByLabelText('Notifications')).toBeTruthy();
  });
});
