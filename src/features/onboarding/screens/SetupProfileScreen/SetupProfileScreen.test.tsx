/**
 * Render + interaction tests for SetupProfileScreen (onboarding step 1).
 * Verifies it mounts, the Skip button advances to InterestSelection, the avatar
 * picker is wired (and the cancelled mock is a no-op), and Continue submits the
 * (empty/valid) form -> persists to the store -> navigates to InterestSelection.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { useOnboardingStore } from '../../store/onboardingStore';
import { SetupProfileScreen } from './SetupProfileScreen';

describe('SetupProfileScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    useOnboardingStore.getState().reset();
    jest.clearAllMocks();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts without throwing and shows the title, inputs and CTAs', () => {
    const { getByText, toJSON } = renderScreen(<SetupProfileScreen />, {
      route: { name: 'Onboarding' },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Tell us about you')).toBeTruthy();
    expect(getByText('Add a photo')).toBeTruthy();
    expect(getByText('Continue')).toBeTruthy();
    expect(getByText('Skip')).toBeTruthy();
  });

  it('Skip navigates to InterestSelection without submitting', () => {
    const { getByText, navigation } = renderScreen(<SetupProfileScreen />, {
      route: { name: 'Onboarding' },
    });
    fireEvent.press(getByText('Skip'));
    expect(navigation.navigate).toHaveBeenCalledWith('InterestSelection');
  });

  it('the avatar picker invokes launchImageLibrary and the cancelled result is a no-op', async () => {
    const { getByText } = renderScreen(<SetupProfileScreen />, {
      route: { name: 'Onboarding' },
    });
    // The avatar Pressable shows a "camera-alt" MaterialIcons (rendered as Text
    // carrying its name by the icon mock). Pressing it bubbles to the Pressable's
    // onPress -> pickImage. The image-picker mock resolves { didCancel: true } so
    // there's no crash and no avatar is set.
    fireEvent.press(getByText('camera-alt'));
    await waitFor(() => {
      expect(launchImageLibrary).toHaveBeenCalled();
    });
  });

  it('Continue submits the (empty, valid) form and navigates to InterestSelection', async () => {
    const { getByText, navigation } = renderScreen(<SetupProfileScreen />, {
      route: { name: 'Onboarding' },
    });
    fireEvent.press(getByText('Continue'));
    // react-hook-form submit + the (no-avatar) async onSubmit resolve, then nav.
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('InterestSelection');
    });
    // No avatar picked => upload skipped, avatarUrl left null in the store.
    expect(useOnboardingStore.getState().avatarUrl).toBeNull();
  });
});
