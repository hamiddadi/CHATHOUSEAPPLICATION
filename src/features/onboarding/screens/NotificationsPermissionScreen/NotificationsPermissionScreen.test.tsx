import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { pushService } from '../../../notifications/services/pushService';
import { NotificationsPermissionScreen } from './NotificationsPermissionScreen';

// pushService transitively requires expo-notifications/expo-device and the
// axios apiClient. Mock it so pressing "Enable" never touches the OS or network.
jest.mock('../../../notifications/services/pushService', () => ({
  pushService: {
    registerWithBackend: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockRegister = pushService.registerWithBackend as jest.Mock;

describe('NotificationsPermissionScreen', () => {
  beforeEach(() => {
    mockRegister.mockReset();
    mockRegister.mockResolvedValue(undefined);
  });

  it('renders the title, benefits and both actions', () => {
    renderScreen(<NotificationsPermissionScreen />);

    expect(screen.getByText(i18n.t('onboarding.notifications.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.notifications.benefits.roomsStarted'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.notifications.benefits.messages'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.notifications.benefits.follows'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.notifications.enable'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.notifications.notNow'))).toBeTruthy();
  });

  it('registers the push token and advances when "Enable" is pressed', async () => {
    const { navigation } = renderScreen(<NotificationsPermissionScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.notifications.enable')));

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows'));
  });

  it('still advances when registration fails (never blocks onboarding)', async () => {
    mockRegister.mockRejectedValueOnce(new Error('permission denied'));
    const { navigation } = renderScreen(<NotificationsPermissionScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.notifications.enable')));

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows'));
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('skips registration and advances when "Not now" is pressed', () => {
    const { navigation } = renderScreen(<NotificationsPermissionScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.notifications.notNow')));

    expect(navigation.navigate).toHaveBeenCalledWith('SuggestedFollows');
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
