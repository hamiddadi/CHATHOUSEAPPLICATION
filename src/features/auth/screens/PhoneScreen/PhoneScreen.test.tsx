import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAuthStore } from '../../store/authStore';
import { PhoneScreen } from './PhoneScreen';

// The real authStore module pulls in services, push, livekit and several
// cross-feature stores at import time. Replace it with a minimal selector-aware
// mock so no network / native work happens and we control `requestOtp`.
jest.mock('../../store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

let requestOtp: jest.Mock;

const wireStore = () => {
  const state = { requestOtp };
  mockUseAuthStore.mockImplementation((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
};

describe('PhoneScreen', () => {
  beforeEach(() => {
    requestOtp = jest.fn().mockResolvedValue(undefined);
    mockUseAuthStore.mockReset();
    wireStore();
  });

  it('renders the title and primary submit action', () => {
    renderScreen(<PhoneScreen />);

    expect(screen.getByText(i18n.t('auth.phone.title'))).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('auth.phone.submit') })).toBeTruthy();
  });

  it('does not request an OTP while the form is invalid (defaults)', () => {
    renderScreen(<PhoneScreen />);

    // Age unconfirmed + only the +1 calling code => form is invalid, so the
    // disabled submit button must not trigger the store action.
    fireEvent.press(screen.getByRole('button', { name: i18n.t('auth.phone.submit') }));

    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('goes back when the close button is pressed', () => {
    const { navigation } = renderScreen(<PhoneScreen />);

    fireEvent.press(screen.getByLabelText(i18n.t('common.close')));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('navigates to the Terms and Privacy screens from the footer links', () => {
    const { navigation } = renderScreen(<PhoneScreen />);

    fireEvent.press(screen.getByLabelText(i18n.t('auth.phone.termsLinkA11y')));
    fireEvent.press(screen.getByLabelText(i18n.t('auth.phone.privacyLinkA11y')));

    expect(navigation.navigate).toHaveBeenCalledWith('Terms');
    expect(navigation.navigate).toHaveBeenCalledWith('PrivacyPolicy');
  });

  it('requests an OTP and navigates to Otp once a valid number and age are provided', async () => {
    const { navigation } = renderScreen(<PhoneScreen />);

    // Confirm age (checkbox row).
    fireEvent.press(screen.getByRole('checkbox'));

    // Type the local part; the screen prefixes the +1 calling code, yielding a
    // canonical E.164 number (+14155551234).
    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('auth.phone.placeholder')),
      '4155551234',
    );

    const submit = screen.getByRole('button', { name: i18n.t('auth.phone.submit') });

    // onChange validation is async; wait until the button is enabled.
    await waitFor(() => {
      expect(submit.props.accessibilityState?.disabled).toBe(false);
    });

    fireEvent.press(submit);

    await waitFor(() => {
      expect(requestOtp).toHaveBeenCalledWith('+14155551234');
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Otp', {
      phoneNumber: '+14155551234',
    });
  });
});
