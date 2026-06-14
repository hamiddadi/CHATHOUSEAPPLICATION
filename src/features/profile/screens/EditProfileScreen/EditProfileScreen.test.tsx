/**
 * Render-test for EditProfileScreen. Primes `useMe()` via seedQueryData so the
 * form (not the loader) renders, then exercises the header Cancel/Save and the
 * footer "Save changes" CTA + the "change photo" affordance.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { profileKeys } from '../../hooks/useProfile';
import type { User } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { EditProfileScreen } from './EditProfileScreen';

const makeMe = (overrides: Partial<User> = {}): User => ({
  id: 'user-test-1',
  username: 'tester',
  displayName: 'Test User',
  firstName: 'Test',
  lastName: 'User',
  bio: 'hello',
  avatarUrl: null,
  twitter: null,
  instagram: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  isOnline: true,
  createdAt: new Date(0).toISOString(),
  invitedBy: null,
  ...overrides,
});

const seedMe = (me: User) => [{ key: [...profileKeys.me()], data: me }];

describe('EditProfileScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    (launchImageLibrary as jest.Mock).mockReset?.();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('renders the loader until `me` is available', () => {
    const { getByLabelText } = renderScreen(<EditProfileScreen />, {
      route: { name: 'EditProfile' },
    });
    expect(getByLabelText('Loading profile')).toBeTruthy();
  });

  it('mounts the form with the title once `me` is primed', () => {
    const { getByText, toJSON } = renderScreen(<EditProfileScreen />, {
      route: { name: 'EditProfile' },
      seedQueryData: seedMe(makeMe()),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Edit profile')).toBeTruthy();
    expect(getByText('Save changes')).toBeTruthy();
  });

  it('header Cancel button calls navigation.goBack', () => {
    const { getByLabelText, navigation } = renderScreen(<EditProfileScreen />, {
      route: { name: 'EditProfile' },
      seedQueryData: seedMe(makeMe()),
    });
    fireEvent.press(getByLabelText('Cancel'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('"change photo" button invokes the image picker without crashing', async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValue({ didCancel: true });
    const { getByLabelText } = renderScreen(<EditProfileScreen />, {
      route: { name: 'EditProfile' },
      seedQueryData: seedMe(makeMe()),
    });
    fireEvent.press(getByLabelText('Change profile photo'));
    await waitFor(() => expect(launchImageLibrary).toHaveBeenCalledTimes(1));
  });

  it('header Save (enabled for a valid handle) fires without throwing', () => {
    const { getByLabelText } = renderScreen(<EditProfileScreen />, {
      route: { name: 'EditProfile' },
      seedQueryData: seedMe(makeMe({ displayName: 'Valid Name', username: 'validuser' })),
    });
    // canSave requires displayName>=2 && a schema-valid username → enabled here.
    expect(() => fireEvent.press(getByLabelText('Save profile'))).not.toThrow();
  });

  it('footer "Save changes" CTA fires without throwing', () => {
    const { getByText } = renderScreen(<EditProfileScreen />, {
      route: { name: 'EditProfile' },
      seedQueryData: seedMe(makeMe({ displayName: 'Valid Name', username: 'validuser' })),
    });
    expect(() => fireEvent.press(getByText('Save changes'))).not.toThrow();
  });
});
