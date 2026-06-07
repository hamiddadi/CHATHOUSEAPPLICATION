import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useNotifPrefs, useUpdateNotifPrefs } from '../../hooks/useNotifPrefs';
import type { NotifPrefs } from '../../services/notifPrefsService';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';

jest.mock('../../hooks/useNotifPrefs', () => {
  const actual = jest.requireActual('../../hooks/useNotifPrefs');
  return { ...actual, useNotifPrefs: jest.fn(), useUpdateNotifPrefs: jest.fn() };
});

const mockUseNotifPrefs = useNotifPrefs as jest.Mock;
const mockUseUpdateNotifPrefs = useUpdateNotifPrefs as jest.Mock;

const allPrefs: NotifPrefs = {
  newFollower: true,
  wave: false,
  roomInvite: true,
  clubInvite: false,
  roomStarted: true,
  eventReminder: false,
  newMessage: true,
  handAccepted: false,
  mention: true,
};

const queryState = (over: Partial<ReturnType<typeof useNotifPrefs>> = {}) =>
  ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    isRefetching: false,
    isFetching: false,
    error: null,
    ...over,
  }) as unknown as ReturnType<typeof useNotifPrefs>;

const mutationState = (over: Record<string, unknown> = {}) =>
  ({
    mutate: jest.fn(),
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
    isError: false,
    reset: jest.fn(),
    ...over,
  }) as unknown as ReturnType<typeof useUpdateNotifPrefs>;

describe('NotificationSettingsScreen', () => {
  beforeEach(() => {
    mockUseNotifPrefs.mockReset();
    mockUseUpdateNotifPrefs.mockReset();
    mockUseUpdateNotifPrefs.mockReturnValue(mutationState());
  });

  it('renders the header title', () => {
    mockUseNotifPrefs.mockReturnValue(queryState({ data: allPrefs }));
    renderScreen(<NotificationSettingsScreen />);
    expect(screen.getByText(i18n.t('notificationSettings.title'))).toBeTruthy();
  });

  it('shows the loader while fetching', () => {
    mockUseNotifPrefs.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<NotificationSettingsScreen />);
    expect(screen.getByLabelText(i18n.t('notificationSettings.title'))).toBeTruthy();
  });

  it('shows the error state and retries when the button is pressed', () => {
    const refetch = jest.fn();
    mockUseNotifPrefs.mockReturnValue(queryState({ isError: true, refetch }));
    renderScreen(<NotificationSettingsScreen />);

    expect(screen.getByText(i18n.t('common.error'))).toBeTruthy();
    fireEvent.press(screen.getByText(i18n.t('common.retry')));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a switch row for each preference when loaded', () => {
    mockUseNotifPrefs.mockReturnValue(queryState({ data: allPrefs }));
    renderScreen(<NotificationSettingsScreen />);

    expect(screen.getByText(i18n.t('notificationSettings.subtitle'))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('notificationSettings.newFollower'))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('notificationSettings.mention'))).toBeTruthy();
  });

  it('calls the update mutation when a switch is toggled', () => {
    const mutate = jest.fn();
    mockUseNotifPrefs.mockReturnValue(queryState({ data: allPrefs }));
    mockUseUpdateNotifPrefs.mockReturnValue(mutationState({ mutate }));
    renderScreen(<NotificationSettingsScreen />);

    // newFollower starts true -> toggling sends false.
    fireEvent(
      screen.getByLabelText(i18n.t('notificationSettings.newFollower')),
      'valueChange',
      false,
    );
    expect(mutate).toHaveBeenCalledWith({ newFollower: false });
  });

  it('goes back when the back button is pressed', async () => {
    mockUseNotifPrefs.mockReturnValue(queryState({ data: allPrefs }));
    const { navigation } = renderScreen(<NotificationSettingsScreen />);

    fireEvent.press(screen.getByLabelText(i18n.t('common.back')));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });
});
