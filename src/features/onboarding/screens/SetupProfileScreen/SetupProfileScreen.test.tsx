/**
 * Render + interaction tests for SetupProfileScreen (onboarding step 1).
 * Verifies it mounts, the Skip button advances to InterestSelection, the avatar
 * picker is wired (cancelled mock is a no-op; a denied gallery permission
 * surfaces an alert with an "Open settings" deep-link), Continue submits the
 * form -> persists to the store -> navigates to InterestSelection, an explicit
 * empty displayName clears a previously-stored one, and re-submitting the same
 * picked image doesn't re-upload its base64.
 */
import React from 'react';
import { Alert, Linking, type AlertButton } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { mediaService } from '../../../../shared/services/api/mediaService';
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
    jest.restoreAllMocks();
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

  it('a denied gallery permission alerts with an "Open settings" deep-link', async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
      errorCode: 'permission',
      errorMessage: 'User did not grant library permission.',
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { getByText } = renderScreen(<SetupProfileScreen />, {
      route: { name: 'Onboarding' },
    });
    fireEvent.press(getByText('camera-alt'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });
    const [title, body, buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      AlertButton[] | undefined,
    ];
    expect(title).toBe('Permission required');
    expect(body).toBe('Allow photo access to choose a picture.');
    const settingsButton = buttons?.find(b => b.text === 'Open settings');
    expect(settingsButton).toBeTruthy();
    settingsButton?.onPress?.();
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
    // No avatar was set: the placeholder icon is still rendered.
    expect(getByText('camera-alt')).toBeTruthy();
  });

  it('a non-permission picker error surfaces the generic error alert', async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
      errorCode: 'others',
      errorMessage: 'boom',
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText } = renderScreen(<SetupProfileScreen />, {
      route: { name: 'Onboarding' },
    });
    fireEvent.press(getByText('camera-alt'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Something went wrong');
    });
    expect(getByText('camera-alt')).toBeTruthy();
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

  it('submitting an empty displayName clears a previously-stored one', async () => {
    // Simulate a first pass through the screen that stored a name.
    useOnboardingStore.getState().setProfile({ displayName: 'First Pass' });
    expect(useOnboardingStore.getState().displayName).toBe('First Pass');
    const { getByText, navigation } = renderScreen(<SetupProfileScreen />, {
      route: { name: 'Onboarding' },
    });
    // The form starts empty; submitting sends an explicit '' which the store
    // treats as "clear it" (instead of silently keeping the old value).
    fireEvent.press(getByText('Continue'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('InterestSelection');
    });
    expect(useOnboardingStore.getState().displayName).toBeUndefined();
  });

  it('re-submitting the same picked image reuses the uploaded URL (no re-upload)', async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValueOnce({
      assets: [{ uri: 'file://avatar.jpg', base64: 'QUJD', type: 'image/jpeg' }],
    });
    const uploadSpy = jest
      .spyOn(mediaService, 'uploadAvatar')
      .mockResolvedValue('https://cdn.test/avatar.jpg');
    const { getByText, queryByText, navigation } = renderScreen(<SetupProfileScreen />, {
      route: { name: 'Onboarding' },
    });
    fireEvent.press(getByText('camera-alt'));
    // Let the async pickImage settle, then the placeholder icon is replaced by
    // the picked image preview. (Two waitFor steps: the first flushes the
    // picker promise, the second observes the re-render.)
    await waitFor(() => {
      expect(launchImageLibrary).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(queryByText('camera-alt')).toBeNull();
    });

    fireEvent.press(getByText('Continue'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('InterestSelection');
    });
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(useOnboardingStore.getState().avatarUrl).toBe('https://cdn.test/avatar.jpg');

    // Second submit with the exact same image: the memoised URL is reused.
    fireEvent.press(getByText('Continue'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledTimes(2);
    });
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(useOnboardingStore.getState().avatarUrl).toBe('https://cdn.test/avatar.jpg');
  });
});
