import React from 'react';
import { Share } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { WaitlistScreen } from './WaitlistScreen';

/**
 * WaitlistScreen — no route params, no queries. Two CTAs: "Invite a friend"
 * opens the native Share sheet; "Back" → goBack. (These i18n keys are absent
 * from en.json, so t() falls back to the inline default English strings.)
 */
describe('WaitlistScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts without throwing and shows the heading + CTAs', () => {
    const { getByText, toJSON } = renderScreen(<WaitlistScreen />);
    expect(toJSON()).toBeTruthy();
    expect(getByText("You're on the waitlist")).toBeTruthy();
    expect(getByText('Invite a friend')).toBeTruthy();
    expect(getByText('Back')).toBeTruthy();
  });

  it('opens the Share sheet when "Invite a friend" is pressed', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const { getByText } = renderScreen(<WaitlistScreen />);

    fireEvent.press(getByText('Invite a friend'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://app.chathouse.com' }),
    );
  });

  it('goes back when "Back" is pressed', () => {
    const { navigation, getByText } = renderScreen(<WaitlistScreen />);
    fireEvent.press(getByText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
