import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import type { User } from '@/shared/types/domain';
import { useFollow, useMe, useProfile, useUnfollow } from '../../hooks/useProfile';
import { useBlock, useReport, useWave } from '../../../social/hooks/useSocial';
import { useHouses } from '../../../houses/hooks/useHouses';
import { useMyRoomHistory } from '../../../rooms/hooks/useRooms';
import { useAuthStore } from '../../../auth/store/authStore';
import { ProfileScreen } from './ProfileScreen';

// Override only the hooks ProfileScreen consumes; keep the real query-key
// factories (profileKeys) the modules also export.
jest.mock('../../hooks/useProfile', () => {
  const actual = jest.requireActual('../../hooks/useProfile');
  return {
    ...actual,
    useMe: jest.fn(),
    useProfile: jest.fn(),
    useFollow: jest.fn(),
    useUnfollow: jest.fn(),
  };
});

jest.mock('../../../social/hooks/useSocial', () => {
  const actual = jest.requireActual('../../../social/hooks/useSocial');
  return {
    ...actual,
    useWave: jest.fn(),
    useBlock: jest.fn(),
    useReport: jest.fn(),
  };
});

jest.mock('../../../houses/hooks/useHouses', () => {
  const actual = jest.requireActual('../../../houses/hooks/useHouses');
  return { ...actual, useHouses: jest.fn() };
});

jest.mock('../../../rooms/hooks/useRooms', () => {
  const actual = jest.requireActual('../../../rooms/hooks/useRooms');
  return { ...actual, useMyRoomHistory: jest.fn() };
});

jest.mock('../../../auth/store/authStore', () => ({ useAuthStore: jest.fn() }));

const mockUseMe = useMe as jest.Mock;
const mockUseProfile = useProfile as jest.Mock;
const mockUseFollow = useFollow as jest.Mock;
const mockUseUnfollow = useUnfollow as jest.Mock;
const mockUseWave = useWave as jest.Mock;
const mockUseBlock = useBlock as jest.Mock;
const mockUseReport = useReport as jest.Mock;
const mockUseHouses = useHouses as jest.Mock;
const mockUseMyRoomHistory = useMyRoomHistory as jest.Mock;
const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

const MY_ID = 'me-1';

const queryState = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  isRefetching: false,
  error: null,
  refetch: jest.fn(),
  ...over,
});

const mutationState = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

const makeUser = (over: Partial<User> = {}): User => ({
  id: 'other-1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  bio: 'Mathematician',
  avatarUrl: null,
  twitter: null,
  instagram: null,
  followersCount: 12,
  followingCount: 34,
  isFollowedByMe: false,
  isOnline: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  invitedBy: null,
  ...over,
});

/** Wire the auth-store mock to expose `{ user: { id } }` via the selector. */
const setAuthUserId = (id: string | undefined): void => {
  const state = { user: id ? { id } : null };
  mockUseAuthStore.mockImplementation((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
};

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setAuthUserId(MY_ID);
    mockUseMe.mockReturnValue(queryState({ data: { id: MY_ID } }));
    mockUseProfile.mockReturnValue(queryState());
    mockUseFollow.mockReturnValue(mutationState());
    mockUseUnfollow.mockReturnValue(mutationState());
    mockUseWave.mockReturnValue(mutationState());
    mockUseBlock.mockReturnValue(mutationState());
    mockUseReport.mockReturnValue(mutationState());
    mockUseHouses.mockReturnValue(queryState({ data: [] }));
    mockUseMyRoomHistory.mockReturnValue(queryState({ data: [] }));
  });

  it('shows the loader while the profile is loading', () => {
    mockUseProfile.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<ProfileScreen />, { routeParams: { userId: 'other-1' } });
    expect(screen.getByLabelText('Loading profile')).toBeTruthy();
  });

  it('shows the empty state when the profile fails to load', () => {
    mockUseProfile.mockReturnValue(queryState({ isError: true }));
    renderScreen(<ProfileScreen />, { routeParams: { userId: 'other-1' } });
    expect(screen.getByText('Profile unavailable')).toBeTruthy();
  });

  it("renders another user's profile with follow/wave actions", () => {
    const user = makeUser();
    mockUseProfile.mockReturnValue(queryState({ data: user }));
    renderScreen(<ProfileScreen />, { routeParams: { userId: user.id } });

    // Headline = real name; the wave action exposes its i18n label.
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Follow')).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('profile.wave'))).toBeTruthy();
    // The "More" affordance only appears for other users.
    expect(screen.getByLabelText(i18n.t('profile.more'))).toBeTruthy();
  });

  it('calls the follow mutation when Follow is pressed', () => {
    const follow = mutationState();
    const user = makeUser({ isFollowedByMe: false });
    mockUseProfile.mockReturnValue(queryState({ data: user }));
    mockUseFollow.mockReturnValue(follow);
    renderScreen(<ProfileScreen />, { routeParams: { userId: user.id } });

    fireEvent.press(screen.getByText('Follow'));
    expect(follow.mutate as jest.Mock).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('navigates back when the back button is pressed', () => {
    const user = makeUser();
    mockUseProfile.mockReturnValue(queryState({ data: user }));
    const { navigation } = renderScreen(<ProfileScreen />, { routeParams: { userId: user.id } });

    fireEvent.press(screen.getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('renders the self profile (edit affordance, no follow button) and navigates to followers', async () => {
    const me = makeUser({ id: MY_ID, username: 'me', displayName: 'My Name' });
    mockUseProfile.mockReturnValue(queryState({ data: me }));
    const { navigation } = renderScreen(<ProfileScreen />, { routeParams: { userId: MY_ID } });

    expect(screen.getByLabelText(i18n.t('profile.editProfile'))).toBeTruthy();
    expect(screen.queryByText('Follow')).toBeNull();

    // "12 Followers" — accessibilityLabel is `${value} ${label}` from ProfileStats.
    fireEvent.press(screen.getByLabelText('12 Followers'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('SettingsTab', {
        screen: 'Followers',
        params: { userId: MY_ID, initialTab: 'followers' },
      });
    });
  });
});
