import React from 'react';
import { Alert, FlatList } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { profileKeys } from '../../../profile/hooks/useProfile';
import { profileService } from '../../../profile/services/profileService';
import type { User } from '../../../../shared/types/domain';
import { renderScreen } from '../../../../test-utils/renderScreen';
import { FollowRequestsScreen } from './FollowRequestsScreen';

const requester = (id = 'requester-1'): User => ({
  id,
  username: id,
  displayName: `User ${id}`,
  bio: null,
  avatarUrl: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  followRequestedByMe: false,
  isOnline: false,
  createdAt: '2026-08-10T12:00:00.000Z',
});

const infinitePage = (items: User[], nextCursor: string | null = null) => ({
  pages: [{ items, nextCursor, hasMore: nextCursor !== null }],
  pageParams: [undefined],
});

const seedRequests = (items: User[], nextCursor: string | null = null) => [
  { key: [...profileKeys.followRequests()], data: infinitePage(items, nextCursor) },
];

describe('FollowRequestsScreen', () => {
  afterEach(() => jest.restoreAllMocks());

  it('announces a loader while the inbox is pending', () => {
    jest
      .spyOn(profileService, 'followRequests')
      .mockReturnValue(new Promise<never>(() => undefined));
    const { getByLabelText } = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
    });
    expect(getByLabelText('Loading follow requests')).toBeTruthy();
  });

  it('renders an actionable, accessible request and opens its profile', () => {
    const { getByText, getByLabelText, navigation } = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
      seedQueryData: seedRequests([requester()]),
    });

    expect(getByText('Follow requests')).toBeTruthy();
    expect(getByLabelText('Accept follow request from User requester-1')).toBeTruthy();
    expect(getByLabelText('Reject follow request from User requester-1')).toBeTruthy();
    fireEvent.press(getByLabelText('View profile of User requester-1'));
    expect(navigation.navigate).toHaveBeenCalledWith('Profile', { userId: 'requester-1' });
  });

  it('accepts once and blocks a competing double action for the same request', async () => {
    const accept = jest
      .spyOn(profileService, 'acceptFollowRequest')
      .mockResolvedValue({ accepted: true });
    const reject = jest
      .spyOn(profileService, 'rejectFollowRequest')
      .mockResolvedValue({ rejected: true });
    jest.spyOn(profileService, 'followRequests').mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    const { getByLabelText } = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
      seedQueryData: seedRequests([requester()]),
    });

    const acceptButton = getByLabelText('Accept follow request from User requester-1');
    const rejectButton = getByLabelText('Reject follow request from User requester-1');
    fireEvent.press(acceptButton);
    fireEvent.press(acceptButton);
    fireEvent.press(rejectButton);

    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    expect(reject).not.toHaveBeenCalled();
  });

  it('cleans up two simultaneous requesters independently', async () => {
    const users = [requester('requester-a'), requester('requester-b')];
    const resolvers = new Map<string, (value: { accepted: true }) => void>();
    const accept = jest.spyOn(profileService, 'acceptFollowRequest').mockImplementation(
      userId =>
        new Promise(resolve => {
          resolvers.set(userId, resolve);
        }),
    );
    jest.spyOn(profileService, 'followRequests').mockResolvedValue({
      items: users,
      nextCursor: null,
      hasMore: false,
    });
    const { getByLabelText } = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
      seedQueryData: seedRequests(users),
    });

    fireEvent.press(getByLabelText('Accept follow request from User requester-a'));
    fireEvent.press(getByLabelText('Accept follow request from User requester-b'));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(2));

    resolvers.get('requester-a')?.({ accepted: true });
    await waitFor(() =>
      expect(
        getByLabelText('Accept follow request from User requester-a').props.accessibilityState,
      ).toMatchObject({ busy: false, disabled: false }),
    );
    expect(
      getByLabelText('Accept follow request from User requester-b').props.accessibilityState,
    ).toMatchObject({ busy: true, disabled: true });

    resolvers.get('requester-b')?.({ accepted: true });
    await waitFor(() =>
      expect(
        getByLabelText('Accept follow request from User requester-b').props.accessibilityState,
      ).toMatchObject({ busy: false, disabled: false }),
    );
  });

  it('rejects a request through the dedicated endpoint', async () => {
    const reject = jest
      .spyOn(profileService, 'rejectFollowRequest')
      .mockResolvedValue({ rejected: true });
    jest.spyOn(profileService, 'followRequests').mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    const { getByLabelText } = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
      seedQueryData: seedRequests([requester()]),
    });

    fireEvent.press(getByLabelText('Reject follow request from User requester-1'));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('requester-1'));
  });

  it('reconciles the inbox and unlocks the row after an ambiguous action failure', async () => {
    jest
      .spyOn(profileService, 'acceptFollowRequest')
      .mockRejectedValue(new Error('response lost after commit'));
    const list = jest.spyOn(profileService, 'followRequests').mockResolvedValue({
      items: [requester()],
      nextCursor: null,
      hasMore: false,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
      seedQueryData: seedRequests([requester()]),
    });

    const acceptButton = getByLabelText('Accept follow request from User requester-1');
    fireEvent.press(acceptButton);

    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(alert).toHaveBeenCalled());
    await waitFor(() =>
      expect(acceptButton.props.accessibilityState).toMatchObject({
        busy: false,
        disabled: false,
      }),
    );
  });

  it('shows empty and retryable error states', async () => {
    const empty = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
      seedQueryData: seedRequests([]),
    });
    expect(empty.getByText('No pending requests')).toBeTruthy();
    empty.unmount();

    const list = jest
      .spyOn(profileService, 'followRequests')
      .mockRejectedValue(new Error('offline'));
    const error = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
    });
    expect(await error.findByText("Couldn't load follow requests")).toBeTruthy();
    fireEvent.press(error.getByText('Retry'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('loads the next composite-cursor page on scroll', async () => {
    const list = jest.spyOn(profileService, 'followRequests').mockResolvedValue({
      items: [requester('requester-2')],
      nextCursor: null,
      hasMore: false,
    });
    const { UNSAFE_getByType } = renderScreen(<FollowRequestsScreen />, {
      route: { name: 'FollowRequests', params: {} },
      seedQueryData: seedRequests([requester()], 'v1.next'),
    });

    UNSAFE_getByType(FlatList).props.onEndReached();
    await waitFor(() => expect(list).toHaveBeenCalledWith('v1.next'));
    await waitFor(() => {
      const rows = UNSAFE_getByType(FlatList).props.data as User[];
      expect(rows.map(row => row.id)).toEqual(['requester-1', 'requester-2']);
    });
  });
});
