/**
 * Render + interaction tests for NotificationsPermissionScreen (onboarding push
 * opt-in step). Verifies it mounts, "Not now" advances to SuggestedFollows, and
 * "Enable notifications" registers with the backend (best-effort, never blocks)
 * then advances to SuggestedFollows. A refusal surfaces an explanatory alert —
 * with an "Open settings" deep-link when the permission is blocked for good —
 * but never blocks the flow.
 */
import React from 'react';
import { Alert, Linking, type AlertButton } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { pushService } from '../../../notifications/services/pushService';
import { NotificationsPermissionScreen } from './NotificationsPermissionScreen';

describe('NotificationsPermissionScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    jest.clearAllMocks();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts without throwing and shows the title, benefits and both CTAs', () => {
    const { getByText, toJSON } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Stay in the loop')).toBeTruthy();
    expect(getByText('Enable notifications')).toBeTruthy();
    expect(getByText('Not now')).toBeTruthy();
    // One of the benefit rows.
    expect(getByText('Never miss a direct message.')).toBeTruthy();
  });

  it('Not now skips straight to SuggestedFollows without registering', () => {
    const registerSpy = jest.spyOn(pushService, 'registerWithBackend').mockResolvedValue('granted');
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Not now'));
    expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('Enable (granted) registers with the backend, advances, and shows no alert', async () => {
    const registerSpy = jest.spyOn(pushService, 'registerWithBackend').mockResolvedValue('granted');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Enable notifications'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
    });
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('Enable (denied) still advances AND explains the refusal in an alert', async () => {
    jest.spyOn(pushService, 'registerWithBackend').mockResolvedValue('denied');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Enable notifications'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Notifications are off',
        'No problem — you can turn them on anytime from your profile settings.',
      );
    });
    // The refusal never blocks the flow.
    expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
  });

  it('Enable (blocked) advances AND offers an "Open settings" deep-link', async () => {
    jest.spyOn(pushService, 'registerWithBackend').mockResolvedValue('blocked');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Enable notifications'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
    const [title, body, buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      AlertButton[] | undefined,
    ];
    expect(title).toBe('Notifications are off');
    expect(body).toContain('blocked');
    const settingsButton = buttons?.find(b => b.text === 'Open settings');
    expect(settingsButton).toBeTruthy();
    settingsButton?.onPress?.();
    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });

  it('Enable still advances even when backend registration rejects', async () => {
    jest.spyOn(pushService, 'registerWithBackend').mockRejectedValue(new Error('no native module'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Enable notifications'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "Notifications weren't enabled",
      'ChatHouse could not finish enabling notifications. You can continue; ChatHouse will try again automatically the next time you open the app.',
    );
  });

  it('Enable (registration error) advances and explains that activation did not finish', async () => {
    jest.spyOn(pushService, 'registerWithBackend').mockResolvedValue('error');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Enable notifications'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Notifications weren't enabled",
        'ChatHouse could not finish enabling notifications. You can continue; ChatHouse will try again automatically the next time you open the app.',
      );
    });
    expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
  });
});
