import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useOnboardingStore } from '../../store/onboardingStore';
import { mediaService } from '../../../../shared/services/api/mediaService';
import { SetupProfileScreen } from './SetupProfileScreen';

// The screen selects `setProfile` from the zustand store. Mock the module so no
// real store state is touched and support both selector and bare access.
jest.mock('../../store/onboardingStore', () => ({
  useOnboardingStore: jest.fn(),
}));

// `uploadAvatar` only fires when an image is picked, but mock it anyway so the
// real apiClient/network is never reached.
jest.mock('../../../../shared/services/api/mediaService', () => ({
  mediaService: { uploadAvatar: jest.fn().mockResolvedValue('https://cdn.example/a.jpg') },
}));

const mockUseOnboardingStore = useOnboardingStore as unknown as jest.Mock;
const mockUploadAvatar = mediaService.uploadAvatar as jest.Mock;

const setProfile = jest.fn();

const storeState = { setProfile };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseOnboardingStore.mockImplementation((selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState,
  );
});

describe('SetupProfileScreen', () => {
  it('renders the title and primary actions', () => {
    renderScreen(<SetupProfileScreen />);

    expect(screen.getByText(i18n.t('onboarding.setupProfile.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.setupProfile.subtitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.setupProfile.continue'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.setupProfile.skip'))).toBeTruthy();
  });

  it('renders the add-photo affordance and the form labels', () => {
    renderScreen(<SetupProfileScreen />);

    expect(screen.getByText(i18n.t('onboarding.setupProfile.addPhoto'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.setupProfile.displayNameLabel'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.setupProfile.bioLabel'))).toBeTruthy();
    // Bio helper starts at "0 / 150".
    expect(screen.getByText('0 / 150')).toBeTruthy();
  });

  it('skips onboarding straight to interest selection', () => {
    const { navigation } = renderScreen(<SetupProfileScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.setupProfile.skip')));

    expect(navigation.navigate).toHaveBeenCalledWith('InterestSelection');
  });

  it('saves the profile and advances when Continue is pressed with no avatar', async () => {
    const { navigation } = renderScreen(<SetupProfileScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.setupProfile.continue')));

    await waitFor(() => {
      expect(setProfile).toHaveBeenCalledWith({
        displayName: undefined,
        bio: undefined,
        avatarUrl: null,
      });
    });
    // No image picked -> no upload attempted.
    expect(mockUploadAvatar).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('InterestSelection');
  });

  it('reflects typed input in the bio character counter', () => {
    renderScreen(<SetupProfileScreen />);

    const bioInput = screen.getByPlaceholderText(i18n.t('onboarding.setupProfile.bioPlaceholder'));
    fireEvent.changeText(bioInput, 'hello');

    expect(screen.getByText('5 / 150')).toBeTruthy();
  });

  it('submits the trimmed display name through to the store', async () => {
    const { navigation } = renderScreen(<SetupProfileScreen />);

    const nameInput = screen.getByPlaceholderText(
      i18n.t('onboarding.setupProfile.displayNamePlaceholder'),
    );
    fireEvent.changeText(nameInput, 'Casey Echo');
    fireEvent.press(screen.getByText(i18n.t('onboarding.setupProfile.continue')));

    await waitFor(() => {
      expect(setProfile).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Casey Echo', avatarUrl: null }),
      );
    });
    expect(navigation.navigate).toHaveBeenCalledWith('InterestSelection');
  });
});
