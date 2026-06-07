import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useMe, useUpdateProfile } from '../../hooks/useProfile';
import { mediaService } from '../../../../shared/services/api/mediaService';
import type { User } from '../../../../shared/types/domain';
import { EditProfileScreen } from './EditProfileScreen';

// Keep the real query-key factory (other code paths rely on it) and override
// only the two data hooks the screen consumes so nothing hits the network.
jest.mock('../../hooks/useProfile', () => {
  const actual = jest.requireActual('../../hooks/useProfile');
  return { ...actual, useMe: jest.fn(), useUpdateProfile: jest.fn() };
});

// Avatar upload would call apiClient; stub it so save never performs real IO.
jest.mock('../../../../shared/services/api/mediaService', () => ({
  mediaService: { uploadAvatar: jest.fn().mockResolvedValue('https://cdn.test/a.jpg') },
}));

const mockUseMe = useMe as jest.Mock;
const mockUseUpdateProfile = useUpdateProfile as jest.Mock;
const mockUploadAvatar = mediaService.uploadAvatar as jest.Mock;

const makeUser = (over: Partial<User> = {}): User => ({
  id: 'u1',
  username: 'janedoe',
  displayName: 'Jane Doe',
  firstName: 'Jane',
  lastName: 'Doe',
  bio: 'Building things',
  avatarUrl: null,
  twitter: null,
  instagram: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  isOnline: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

const queryState = (over: Partial<ReturnType<typeof useMe>> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  isRefetching: false,
  isFetching: false,
  ...over,
});

const mutationState = (over: Record<string, unknown> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(makeUser()),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

describe('EditProfileScreen', () => {
  beforeEach(() => {
    mockUseMe.mockReset();
    mockUseUpdateProfile.mockReset();
    mockUploadAvatar.mockClear();
    mockUseUpdateProfile.mockReturnValue(mutationState());
  });

  it('shows the loading state while the profile is fetching', () => {
    mockUseMe.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<EditProfileScreen />);
    expect(screen.getByLabelText(i18n.t('profile.edit.loading', 'Loading profile'))).toBeTruthy();
  });

  it('renders the editor populated from the loaded profile', () => {
    mockUseMe.mockReturnValue(queryState({ data: makeUser() }));
    renderScreen(<EditProfileScreen />);
    expect(screen.getByText(i18n.t('profile.edit.title', 'Edit profile'))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('profile.edit.saveA11y', 'Save profile'))).toBeTruthy();
    // The display-name input is prefilled with the user's value.
    expect(screen.getByDisplayValue('Jane Doe')).toBeTruthy();
  });

  it('goes back when the cancel control is pressed', () => {
    mockUseMe.mockReturnValue(queryState({ data: makeUser() }));
    const { navigation } = renderScreen(<EditProfileScreen />);
    fireEvent.press(screen.getByLabelText(i18n.t('profile.edit.cancelA11y', 'Cancel')));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('saves the edited profile and returns when Save is pressed', async () => {
    const mutateAsync = jest.fn().mockResolvedValue(makeUser());
    mockUseUpdateProfile.mockReturnValue(mutationState({ mutateAsync }));
    mockUseMe.mockReturnValue(queryState({ data: makeUser() }));
    const { navigation } = renderScreen(<EditProfileScreen />);

    fireEvent.changeText(screen.getByDisplayValue('Jane Doe'), 'Jane Updated');
    fireEvent.press(screen.getByLabelText(i18n.t('profile.edit.saveA11y', 'Save profile')));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Jane Updated',
        username: 'janedoe',
        avatarUrl: undefined,
      }),
    );
    // No new image was picked, so no upload should happen.
    expect(mockUploadAvatar).not.toHaveBeenCalled();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  });

  it('does not submit when the display name is too short', () => {
    const mutateAsync = jest.fn().mockResolvedValue(makeUser());
    mockUseUpdateProfile.mockReturnValue(mutationState({ mutateAsync }));
    mockUseMe.mockReturnValue(queryState({ data: makeUser() }));
    renderScreen(<EditProfileScreen />);

    fireEvent.changeText(screen.getByDisplayValue('Jane Doe'), 'A');
    fireEvent.press(screen.getByLabelText(i18n.t('profile.edit.saveA11y', 'Save profile')));

    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
