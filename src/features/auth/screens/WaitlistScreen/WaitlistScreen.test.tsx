import React from 'react';
import { Share } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { WaitlistScreen } from './WaitlistScreen';

describe('WaitlistScreen', () => {
  let shareSpy: jest.SpyInstance;

  beforeEach(() => {
    shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction } as Awaited<ReturnType<typeof Share.share>>);
  });

  afterEach(() => {
    shareSpy.mockRestore();
  });

  it('renders without crashing and shows the waitlist title', () => {
    renderScreen(<WaitlistScreen />);
    expect(screen.getByText("You're on the waitlist")).toBeTruthy();
  });

  it('renders the explanatory subtitle', () => {
    renderScreen(<WaitlistScreen />);
    expect(
      screen.getByText(
        "We'll let you know the moment a spot opens up. In the meantime, invite a friend to move up the queue.",
      ),
    ).toBeTruthy();
  });

  it('renders both the invite and back actions', () => {
    renderScreen(<WaitlistScreen />);
    expect(screen.getByRole('button', { name: 'Invite a friend' })).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('common.back') })).toBeTruthy();
  });

  it('calls navigation.goBack when Back is pressed', () => {
    const { navigation } = renderScreen(<WaitlistScreen />);
    fireEvent.press(screen.getByRole('button', { name: i18n.t('common.back') }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('opens the share sheet with the invite message when Invite a friend is pressed', async () => {
    renderScreen(<WaitlistScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Invite a friend' }));
    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://app.chathouse.com' }),
    );
  });

  it('swallows share cancellation without crashing', async () => {
    shareSpy.mockRejectedValueOnce(new Error('User did not share'));
    const { navigation } = renderScreen(<WaitlistScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Invite a friend' }));
    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    // No navigation side-effect on cancellation; screen stays mounted.
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(screen.getByText("You're on the waitlist")).toBeTruthy();
  });
});
