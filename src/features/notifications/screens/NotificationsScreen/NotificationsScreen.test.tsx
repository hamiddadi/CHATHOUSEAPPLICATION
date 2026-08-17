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
import { notificationService } from '../../services/notificationService';
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

const infinitePage = (notifs: AppNotification[], nextCursor: string | null = null) => ({
  pages: [{ items: notifs, nextCursor, hasMore: nextCursor !== null }],
  pageParams: [undefined],
});

const seedNotifs = (notifs: AppNotification[]) => [
  { key: [...notificationKeys.list('all')], data: infinitePage(notifs) },
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
    expect(getByText('Follow requests')).toBeTruthy();
  });

  it('opens the actionable follow-request inbox from the persistent entry point', () => {
    const { getByLabelText, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([]),
    });
    fireEvent.press(getByLabelText('Open follow requests'));
    expect(navigation.navigate).toHaveBeenCalledWith('FollowRequests');
  });

  it('renders the primed notification row', () => {
    const { getByLabelText, getByText } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([makeNotif()]),
    });
    expect(getByText('Some One started following you.')).toBeTruthy();
    expect(getByLabelText('Unread notification: Some One started following you.')).toBeTruthy();
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
        { key: [...notificationKeys.list('rooms')], data: infinitePage([]) },
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

  it('tapping a follow_request notification opens its accept/reject inbox', async () => {
    const { getByText, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([
        makeNotif({
          kind: 'follow_request',
          message: 'Someone requested to follow you.',
        }),
      ]),
    });
    fireEvent.press(getByText('Someone requested to follow you.'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('FollowRequests'));
  });

  it('shows the exact unread backend count instead of only loaded-page rows', () => {
    const { getByText } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: [
        ...seedNotifs([makeNotif({ isRead: false })]),
        { key: [...notificationKeys.unread()], data: 73 },
      ],
    });
    expect(getByText('73 unread')).toBeTruthy();
    expect(getByText('Mark all as read')).toBeTruthy();
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

  it('tapping a house_invite notification deep-links to the HouseInvitation screen', async () => {
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
    // Route to the Accept/Decline invitation screen (not the dead-end HouseDetail).
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('HouseInvitation', { houseId: 'house-3' }),
    );
  });

  it('tapping a mention notification (roomId present) deep-links to the Room', async () => {
    const { getByText, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([
        makeNotif({
          id: 'notif-mention',
          kind: 'mention',
          roomId: 'room-mention-1',
          message: 'You were mentioned in a room.',
        }),
      ]),
    });
    fireEvent.press(getByText('You were mentioned in a room.'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'room-mention-1' }),
    );
  });

  it('tapping a new_message notification hops cross-tab to the DM thread', async () => {
    const { getByText, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([
        makeNotif({
          id: 'notif-dm',
          kind: 'new_message',
          actor: { id: 'peer-7', username: 'peer', displayName: 'Peer', avatarUrl: null },
          message: 'Peer sent you a message.',
        }),
      ]),
    });
    fireEvent.press(getByText('Peer sent you a message.'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('Main', {
        screen: 'MessagesTab',
        params: { screen: 'ChatDetail', params: { conversationId: 'peer-7' } },
      }),
    );
  });

  it('tapping a group NEW_MESSAGE opens GroupChat instead of a DM', async () => {
    const { getByText, navigation } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: seedNotifs([
        makeNotif({
          id: 'notif-group',
          kind: 'new_message',
          actor: { id: 'sender-7', username: 'sender', displayName: 'Sender', avatarUrl: null },
          conversationId: 'group-42',
          conversationType: 'group',
          message: 'New message in Product team.',
        }),
      ]),
    });
    fireEvent.press(getByText('New message in Product team.'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('Main', {
        screen: 'MessagesTab',
        params: { screen: 'GroupChat', params: { conversationId: 'group-42' } },
      }),
    );
  });

  it('loads and appends the next notification page with the opaque cursor', async () => {
    const cursor = 'v1.WyIyMDI2LTA4LTEwVDEyOjAwOjAwLjAwMFoiLCJuLTQ5Il0';
    const listSpy = jest.spyOn(notificationService, 'list').mockResolvedValue({
      items: [makeNotif({ id: 'notif-page-2', message: 'Older notification.' })],
      nextCursor: null,
      hasMore: false,
    });
    const { UNSAFE_getByType } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
      seedQueryData: [
        {
          key: [...notificationKeys.list('all')],
          data: infinitePage([makeNotif()], cursor),
        },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FlatList } = require('react-native');
    UNSAFE_getByType(FlatList).props.onEndReached();

    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('all', cursor));
    await waitFor(() => {
      const rows = UNSAFE_getByType(FlatList).props.data as AppNotification[];
      expect(rows.map(row => row.id)).toEqual(['notif-1', 'notif-page-2']);
    });
  });

  it('load failure shows an error state whose Retry refetches the list', async () => {
    const listSpy = jest
      .spyOn(notificationService, 'list')
      .mockRejectedValue({ kind: 'network', message: 'down' });
    const { findByText } = renderScreen(<NotificationsScreen />, {
      route: { name: 'Notifications', params: {} },
    });
    // Error state — not the misleading "You're all caught up." empty state.
    expect(await findByText("Couldn't load notifications")).toBeTruthy();
    expect(listSpy).toHaveBeenCalledTimes(1);
    fireEvent.press(await findByText('Retry'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
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
