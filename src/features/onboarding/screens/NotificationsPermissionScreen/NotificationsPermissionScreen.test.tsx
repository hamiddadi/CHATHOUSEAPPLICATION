/**
 * Render + interaction tests for NotificationsPermissionScreen (onboarding push
 * opt-in step). Verifies it mounts, "Not now" advances to SuggestedFollows, and
 * "Enable notifications" registers with the backend (best-effort, never blocks)
 * then advances to SuggestedFollows.
 */
import React from 'react';
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
    const registerSpy = jest.spyOn(pushService, 'registerWithBackend').mockResolvedValue(undefined);
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Not now'));
    expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('Enable registers with the backend then advances to SuggestedFollows', async () => {
    const registerSpy = jest.spyOn(pushService, 'registerWithBackend').mockResolvedValue(undefined);
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Enable notifications'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
    });
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });

  it('Enable still advances even when backend registration rejects', async () => {
    jest.spyOn(pushService, 'registerWithBackend').mockRejectedValue(new Error('no native module'));
    const { getByText, navigation } = renderScreen(<NotificationsPermissionScreen />, {
      route: { name: 'NotificationsPermission' },
    });
    fireEvent.press(getByText('Enable notifications'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
    });
  });
});
