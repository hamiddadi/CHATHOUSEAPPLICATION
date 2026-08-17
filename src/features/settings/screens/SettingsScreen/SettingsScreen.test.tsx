/**
 * Render-test for SettingsScreen (the user's own profile + app settings hub).
 * The screen reads `useMe()` / `useHouses('mine')` / `useAdminWhoami()` and a
 * signed-invite query. Profile and house failures have explicit retry states,
 * so tests prime their caches for the success path and reject their services
 * for the failure path. The primary controls cover the Wave + More header
 * actions (open an Alert), Edit
 * profile / Create House / notification + blocked-accounts rows (navigate),
 * the analytics privacy toggle (mutates the consent store), and the stat taps.
 */
import React from 'react';
import { Alert, Share } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { profileKeys } from '../../../profile/hooks/useProfile';
import { profileService } from '../../../profile/services/profileService';
import { houseKeys } from '../../../houses/hooks/useHouses';
import { houseService } from '../../../houses/services/houseService';
import type { HouseSummary, User } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { SettingsScreen } from './SettingsScreen';

const SELF_ID = 'user-test-1';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: SELF_ID,
  username: 'tester',
  displayName: 'Test User',
  firstName: 'Test',
  lastName: 'User',
  bio: 'A short bio for the settings header.',
  avatarUrl: null,
  twitter: null,
  instagram: null,
  followersCount: 1200,
  followingCount: 34,
  isFollowedByMe: false,
  isOnline: true,
  createdAt: new Date('2024-03-01T00:00:00.000Z').toISOString(),
  invitedBy: null,
  ...overrides,
});

const makeHouse = (overrides: Partial<HouseSummary> = {}): HouseSummary => ({
  id: 'house-1',
  name: 'Design Club',
  category: 'design',
  categoryEmoji: '🎨',
  iconUrl: null,
  membersCount: 42,
  privacy: 'open',
  ...overrides,
});

const seedMe = (user: User) => ({ key: [...profileKeys.me()], data: user });
const seedHouses = (houses: HouseSummary[]) => ({
  key: [...houseKeys.list('mine')],
  data: houses,
});

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockAuthenticated({ id: SELF_ID });
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and shows the authed user display name + handle', () => {
    const { getByText, toJSON } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Test User')).toBeTruthy();
    expect(getByText('@tester')).toBeTruthy();
  });

  it('keeps the app header and shows a retryable error without a fake profile', async () => {
    const meSpy = jest.spyOn(profileService, 'me').mockRejectedValue(new Error('offline'));
    const { findByText, getByText, queryByText } = renderScreen(<SettingsScreen />);

    expect(getByText('ChatHouse')).toBeTruthy();
    expect(queryByText('Your profile')).toBeNull();
    expect(await findByText("Couldn't load your settings.")).toBeTruthy();
    expect(queryByText('@username')).toBeNull();

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(meSpy).toHaveBeenCalledTimes(2));
  });

  it('renders member-of house tiles when houses are primed', () => {
    const { getByLabelText } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser()), seedHouses([makeHouse()])],
    });
    expect(getByLabelText('Open Design Club')).toBeTruthy();
  });

  it('shows a local retry state instead of an empty houses grid on failure', async () => {
    const housesSpy = jest.spyOn(houseService, 'list').mockRejectedValue(new Error('offline'));
    const { findByText, getByText, queryByText } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });

    expect(await findByText("Couldn't load houses")).toBeTruthy();
    expect(queryByText('No houses yet')).toBeNull();

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(housesSpy).toHaveBeenCalledTimes(2));
  });

  it('Wave button opens the wave-hint Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getAllByLabelText } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    // Two "Send a wave" buttons share the label (the top-bar pill +
    // the secondary action next to Edit profile); both call handleWave.
    const waveButtons = getAllByLabelText('Send a wave');
    expect(waveButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.press(waveButtons[0]);
    expect(alertSpy).toHaveBeenCalled();
  });

  it('More button opens the account (sign out) Alert action sheet', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('More options'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('Edit profile button navigates to EditProfile', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('Edit profile'));
    expect(navigation.navigate).toHaveBeenCalledWith('EditProfile');
  });

  it('Create House button navigates into the Rooms stack', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('Create a new house'));
    expect(navigation.navigate).toHaveBeenCalledWith('RoomsTab', { screen: 'CreateHouse' });
  });

  it('View all button navigates to the HouseList', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('View all'));
    expect(navigation.navigate).toHaveBeenCalledWith('RoomsTab', { screen: 'HouseList' });
  });

  it('tapping a house tile navigates to its HouseDetail', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser()), seedHouses([makeHouse()])],
    });
    fireEvent.press(getByLabelText('Open Design Club'));
    expect(navigation.navigate).toHaveBeenCalledWith('RoomsTab', {
      screen: 'HouseDetail',
      params: { houseId: 'house-1' },
    });
  });

  it('Followers stat navigates to the Followers list (followers tab)', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    // formatCount(1200) → "1.2K"; Stat a11y label = `${value} ${label}`.
    fireEvent.press(getByLabelText('1.2K Followers'));
    expect(navigation.navigate).toHaveBeenCalledWith('Followers', {
      userId: SELF_ID,
      initialTab: 'followers',
    });
  });

  it('Following stat navigates to the Followers list (following tab)', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('34 Following'));
    expect(navigation.navigate).toHaveBeenCalledWith('Followers', {
      userId: SELF_ID,
      initialTab: 'following',
    });
  });

  it('Notifications row navigates to NotificationSettings', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('Notifications'));
    expect(navigation.navigate).toHaveBeenCalledWith('NotificationSettings');
  });

  it('shares the localized personal invite message', () => {
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    const inviteUrl = 'https://app.chathouse.com/invite/test-code';
    const { getByLabelText } = renderScreen(<SettingsScreen />, {
      seedQueryData: [
        seedMe(makeUser()),
        {
          key: ['ext', 'invite', 'link'],
          data: { url: inviteUrl, code: 'test-code', remaining: 2 },
        },
      ],
    });

    fireEvent.press(getByLabelText('Invite friends'));

    expect(shareSpy).toHaveBeenCalledWith({
      message: `Join me on ChatHouse 👋 ${inviteUrl}`,
      url: inviteUrl,
    });
  });

  it('Blocked accounts row navigates to BlockedUsers', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('Blocked accounts'));
    expect(navigation.navigate).toHaveBeenCalledWith('BlockedUsers');
  });

  it('Delete account row navigates to DeleteAccount', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('Delete my account'));
    expect(navigation.navigate).toHaveBeenCalledWith('DeleteAccount');
  });

  it('Privacy policy + Terms rows navigate to their screens', () => {
    const { getByLabelText, navigation } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    fireEvent.press(getByLabelText('Privacy Policy'));
    expect(navigation.navigate).toHaveBeenCalledWith('PrivacyPolicy');
    fireEvent.press(getByLabelText('Terms of Service'));
    expect(navigation.navigate).toHaveBeenCalledWith('Terms');
  });

  it('anonymous-reporting toggle press does not throw (mutates consent store)', () => {
    const { getByLabelText } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    expect(() => fireEvent.press(getByLabelText('Allow anonymous crash reporting'))).not.toThrow();
  });

  it('exposes a discoverable "Sign out" account row that opens a confirmation Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    // Sign out must be reachable from a labelled account-section row, not only
    // buried behind the "…" header menu (audit QA 2026-07-02 discoverability).
    fireEvent.press(getByLabelText('Sign out'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('See more / less toggles the bio without throwing', () => {
    const { getByLabelText } = renderScreen(<SettingsScreen />, {
      seedQueryData: [seedMe(makeUser())],
    });
    // Initially collapsed → label is "Expand bio".
    fireEvent.press(getByLabelText('Expand bio'));
    // Now expanded → the collapse affordance is present.
    expect(getByLabelText('Collapse bio')).toBeTruthy();
  });
});
