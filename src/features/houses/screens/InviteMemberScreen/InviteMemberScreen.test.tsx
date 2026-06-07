import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { useSearchUsers } from '../../../profile/hooks/useProfile';
import { useInviteToHouse } from '../../hooks/useHouses';
import type { User } from '../../../../shared/types/domain';
import { InviteMemberScreen } from './InviteMemberScreen';

jest.mock('../../../profile/hooks/useProfile', () => {
  const actual = jest.requireActual('../../../profile/hooks/useProfile');
  return { ...actual, useSearchUsers: jest.fn() };
});

jest.mock('../../hooks/useHouses', () => {
  const actual = jest.requireActual('../../hooks/useHouses');
  return { ...actual, useInviteToHouse: jest.fn() };
});

const mockUseSearchUsers = useSearchUsers as jest.Mock;
const mockUseInviteToHouse = useInviteToHouse as jest.Mock;

const HOUSE_ID = 'house-1';

const queryState = (over: Partial<Record<string, unknown>> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  isRefetching: false,
  refetch: jest.fn(),
  ...over,
});

const mutationState = (over: Partial<Record<string, unknown>> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

const makeUser = (over: Partial<User> = {}): User => ({
  id: 'u1',
  username: 'janedoe',
  displayName: 'Jane Doe',
  bio: null,
  avatarUrl: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  isOnline: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const renderInviteScreen = () =>
  renderScreen(<InviteMemberScreen />, {
    routeName: 'InviteMember',
    routeParams: { houseId: HOUSE_ID },
  });

describe('InviteMemberScreen', () => {
  beforeEach(() => {
    mockUseSearchUsers.mockReset();
    mockUseInviteToHouse.mockReset();
    mockUseInviteToHouse.mockReturnValue(mutationState());
  });

  it('renders the header and invite link without crashing', () => {
    mockUseSearchUsers.mockReturnValue(queryState({ data: [] }));
    renderInviteScreen();
    expect(screen.getByText('Invite Member')).toBeTruthy();
    expect(screen.getByText(`app.chathouse.com/invite/${HOUSE_ID}`)).toBeTruthy();
    expect(screen.getByLabelText('Copy invite link')).toBeTruthy();
  });

  it('shows the loader while searching', () => {
    mockUseSearchUsers.mockReturnValue(queryState({ isLoading: true }));
    renderInviteScreen();
    expect(screen.getByLabelText('Searching users')).toBeTruthy();
  });

  it('shows the default empty state when no query has been entered', () => {
    mockUseSearchUsers.mockReturnValue(queryState({ data: [] }));
    renderInviteScreen();
    expect(screen.getByText('Inviter des membres')).toBeTruthy();
  });

  it('renders a row for each matched user', () => {
    mockUseSearchUsers.mockReturnValue(queryState({ data: [makeUser()] }));
    renderInviteScreen();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('@janedoe')).toBeTruthy();
    expect(screen.getByText('Invite')).toBeTruthy();
  });

  it('invites a user with the right payload when the row button is pressed', () => {
    const mutate = jest.fn();
    mockUseInviteToHouse.mockReturnValue(mutationState({ mutate }));
    mockUseSearchUsers.mockReturnValue(queryState({ data: [makeUser({ id: 'u42' })] }));
    renderInviteScreen();

    fireEvent.press(screen.getByText('Invite'));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      { houseId: HOUSE_ID, userIds: ['u42'] },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('goes back when the close button is pressed', async () => {
    mockUseSearchUsers.mockReturnValue(queryState({ data: [] }));
    const { navigation } = renderInviteScreen();

    fireEvent.press(screen.getByLabelText('Close invite dialog'));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });
});
