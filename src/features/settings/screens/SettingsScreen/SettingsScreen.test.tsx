import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import type { User, HouseSummary } from '@/shared/types/domain';
import { useMe } from '../../../profile/hooks/useProfile';
import { useHouses } from '../../../houses/hooks/useHouses';
import { useAuthStore } from '../../../auth/store/authStore';
import { useAnalyticsConsentStore } from '../../../privacy';
import { useAdminWhoami } from '../../../admin';
import { invitesApi } from '../../../extensions/api/invitesApi';
import { SettingsScreen } from './SettingsScreen';

// Override only the data hooks the screen consumes; keep each module's other
// exports (query-key factories) real where they live alongside the hook.
jest.mock('../../../profile/hooks/useProfile', () => {
  const actual = jest.requireActual('../../../profile/hooks/useProfile');
  return { ...actual, useMe: jest.fn() };
});

jest.mock('../../../houses/hooks/useHouses', () => {
  const actual = jest.requireActual('../../../houses/hooks/useHouses');
  return { ...actual, useHouses: jest.fn() };
});

jest.mock('../../../auth/store/authStore', () => ({ useAuthStore: jest.fn() }));

// The privacy barrel re-exports heavy screen components; provide a minimal
// inline factory exposing only the store the screen selects from.
jest.mock('../../../privacy', () => ({ useAnalyticsConsentStore: jest.fn() }));

// The admin barrel re-exports the whole Godmode surface; mock the whoami hook
// and reimplement isAtLeast (rank comparison) so the visibility branch is real.
jest.mock('../../../admin', () => {
  const RANK: Record<string, number> = { USER: 0, MODERATOR: 1, ADMIN: 2, SUPER_ADMIN: 3 };
  return {
    useAdminWhoami: jest.fn(),
    isAtLeast: (have: string, need: string) => (RANK[have] ?? 0) >= (RANK[need] ?? 0),
  };
});

jest.mock('../../../extensions/api/invitesApi', () => ({
  invitesApi: {
    getLink: jest
      .fn()
      .mockResolvedValue({ url: 'https://x.test/i/abc', code: 'abc', remaining: 3 }),
    redeem: jest.fn(),
  },
}));

// Premium row pulls its own react-query/Stripe hooks; render it inert here.
jest.mock('../../../extensions/components/ExtPremiumRow', () => ({
  ExtPremiumRow: () => null,
}));

const mockUseMe = useMe as jest.Mock;
const mockUseHouses = useHouses as jest.Mock;
const mockUseAuthStore = useAuthStore as unknown as jest.Mock;
const mockUseAnalyticsConsentStore = useAnalyticsConsentStore as unknown as jest.Mock;
const mockUseAdminWhoami = useAdminWhoami as jest.Mock;
const mockGetLink = invitesApi.getLink as jest.Mock;

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

const makeUser = (over: Partial<User> = {}): User => ({
  id: 'me-1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  bio: null,
  avatarUrl: null,
  twitter: null,
  instagram: null,
  followersCount: 1200,
  followingCount: 42,
  isFollowedByMe: false,
  isOnline: true,
  createdAt: '2026-03-01T00:00:00.000Z',
  invitedBy: null,
  ...over,
});

const makeHouse = (over: Partial<HouseSummary> = {}): HouseSummary => ({
  id: 'h-1',
  name: 'Design Club',
  category: 'design',
  categoryEmoji: '🎨',
  iconUrl: null,
  membersCount: 10,
  privacy: 'open',
  ...over,
});

const signOut = jest.fn().mockResolvedValue(undefined);

/** Auth store exposes only `signOut` to this screen (selected via `s => s.signOut`). */
const wireAuthStore = (): void => {
  const state = { signOut };
  mockUseAuthStore.mockImplementation((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
};

/** Analytics consent store exposes `enabled` + `setEnabled` via selectors. */
const wireConsentStore = (enabled: boolean, setEnabled: jest.Mock): void => {
  const state = { enabled, setEnabled };
  mockUseAnalyticsConsentStore.mockImplementation((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
};

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLink.mockResolvedValue({ url: 'https://x.test/i/abc', code: 'abc', remaining: 3 });
    wireAuthStore();
    wireConsentStore(false, jest.fn().mockResolvedValue(undefined));
    mockUseMe.mockReturnValue(queryState({ data: makeUser() }));
    mockUseHouses.mockReturnValue(queryState({ data: [] }));
    mockUseAdminWhoami.mockReturnValue(queryState());
  });

  it('renders the profile header and primary actions', () => {
    renderScreen(<SettingsScreen />);
    // App title in the top bar (i18n EN default).
    expect(screen.getByText(i18n.t('common.appName'))).toBeTruthy();
    // Display name from the loaded user.
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    // Edit-profile affordance exposes its i18n accessibility label.
    expect(screen.getByLabelText(i18n.t('settings.editProfile'))).toBeTruthy();
  });

  it('falls back to placeholder identity when the user has not loaded', () => {
    mockUseMe.mockReturnValue(queryState({ data: undefined }));
    renderScreen(<SettingsScreen />);
    expect(screen.getByText(i18n.t('settings.yourProfile'))).toBeTruthy();
    // The clubs count defaults to 0 when no houses are loaded.
    expect(screen.getByLabelText(`0 ${i18n.t('settings.clubs')}`)).toBeTruthy();
  });

  it('navigates to the followers list when the followers stat is pressed', () => {
    const user = makeUser({ followersCount: 1200 });
    mockUseMe.mockReturnValue(queryState({ data: user }));
    const { navigation } = renderScreen(<SettingsScreen />);
    // Stat accessibilityLabel is `${value} ${label}`; 1200 -> "1.2K".
    fireEvent.press(screen.getByLabelText(`1.2K ${i18n.t('settings.followers')}`));
    expect(navigation.navigate).toHaveBeenCalledWith('Followers', {
      userId: user.id,
      initialTab: 'followers',
    });
  });

  it('navigates to the create-house flow when Create House is pressed', () => {
    const { navigation } = renderScreen(<SettingsScreen />);
    fireEvent.press(screen.getByLabelText(i18n.t('settings.createHouseA11y')));
    expect(navigation.navigate).toHaveBeenCalledWith('RoomsTab', { screen: 'CreateHouse' });
  });

  it('hides the Godmode entry for regular users and shows it for moderators', () => {
    const { rerender } = renderScreen(<SettingsScreen />);
    expect(screen.queryByLabelText(i18n.t('settings.openGodmodeA11y'))).toBeNull();

    mockUseAdminWhoami.mockReturnValue(queryState({ data: { appRole: 'MODERATOR' } }));
    rerender(<SettingsScreen />);
    expect(screen.getByLabelText(i18n.t('settings.openGodmodeA11y'))).toBeTruthy();
  });

  it('toggles anonymous analytics consent when the switch is pressed', async () => {
    const setEnabled = jest.fn().mockResolvedValue(undefined);
    wireConsentStore(false, setEnabled);
    renderScreen(<SettingsScreen />);

    fireEvent.press(screen.getByLabelText(i18n.t('settings.anonymousErrorReportingA11y')));
    await waitFor(() => {
      expect(setEnabled).toHaveBeenCalledWith(true);
    });
  });

  it('renders houses the user is a member of and opens one on press', () => {
    const house = makeHouse({ id: 'h-9', name: 'Design Club' });
    mockUseHouses.mockReturnValue(queryState({ data: [house] }));
    const { navigation } = renderScreen(<SettingsScreen />);

    fireEvent.press(screen.getByLabelText(`Open ${house.name}`));
    expect(navigation.navigate).toHaveBeenCalledWith('RoomsTab', {
      screen: 'HouseDetail',
      params: { houseId: house.id },
    });
  });
});
