import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { useToastStore } from '../../../../shared/components/Toast';
import { useAuthStore } from '../../store/authStore';
import { PhoneScreen } from './PhoneScreen';

/**
 * PhoneScreen — phone-number entry. Back arrow → goBack; Terms / Privacy text
 * links → navigate('Terms'|'PrivacyPolicy'); the "Send code" submit is disabled
 * until the RHF form is valid (a libphonenumber-valid number AND the age
 * checkbox). Submitting calls store.requestOtp then navigates to 'Otp'.
 */
describe('PhoneScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    useToastStore.getState().clear();
    jest.restoreAllMocks();
  });

  it('mounts without throwing and shows the title + submit', () => {
    const { getByText, toJSON } = renderScreen(<PhoneScreen />, {
      route: { name: 'Phone', params: {} },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Enter your number')).toBeTruthy();
    expect(getByText('Send code')).toBeTruthy();
  });

  it('goes back when the header back button is pressed', () => {
    const { navigation, getByLabelText } = renderScreen(<PhoneScreen />, {
      route: { name: 'Phone', params: {} },
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('navigates to Terms and PrivacyPolicy from the footer links', () => {
    const { navigation, getByLabelText } = renderScreen(<PhoneScreen />, {
      route: { name: 'Phone', params: {} },
    });
    fireEvent.press(getByLabelText('Terms of Service'));
    expect(navigation.navigate).toHaveBeenCalledWith('Terms');
    fireEvent.press(getByLabelText('Privacy Policy'));
    expect(navigation.navigate).toHaveBeenCalledWith('PrivacyPolicy');
  });

  it('toggles the age-confirmation checkbox without crashing', () => {
    const { getByRole } = renderScreen(<PhoneScreen />, {
      route: { name: 'Phone', params: {} },
    });
    const checkbox = getByRole('checkbox');
    expect(checkbox.props.accessibilityState.checked).toBe(false);
    fireEvent.press(checkbox);
    expect(checkbox.props.accessibilityState.checked).toBe(true);
  });

  it('requests an OTP and navigates to Otp after a valid submission', async () => {
    const requestOtp = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ requestOtp });

    const { getByPlaceholderText, getByRole, getByText, navigation } = renderScreen(
      <PhoneScreen />,
      { route: { name: 'Phone', params: {} } },
    );

    // Placeholder resolves to the en.json example number (auth.phone.placeholder).
    // US calling code (+1) is prefilled; enter a valid local number.
    fireEvent.changeText(getByPlaceholderText('+1 415 555 1234'), '4155551234');
    // Confirm age so the form becomes valid.
    fireEvent.press(getByRole('checkbox'));

    // Submit becomes enabled once valid; press it.
    await waitFor(() => {
      fireEvent.press(getByText('Send code'));
      expect(requestOtp).toHaveBeenCalledWith('+14155551234');
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Otp', { phoneNumber: '+14155551234' });
  });

  it('rejects an E.164-shaped but impossible number (libphonenumber isValid)', async () => {
    const requestOtp = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ requestOtp });

    const { getByPlaceholderText, getByRole, getByText, findByText } = renderScreen(
      <PhoneScreen />,
      { route: { name: 'Phone', params: {} } },
    );

    // 9 digits — passes the E.164 regex but is too short for a US number.
    fireEvent.changeText(getByPlaceholderText('+1 415 555 1234'), '415555123');
    fireEvent.press(getByRole('checkbox'));

    // Field-level error surfaces (auth.phone.errors.invalid).
    expect(await findByText('Invalid number. Expected format: +14155551234.')).toBeTruthy();
    // The submit stays disabled → pressing it is a no-op.
    fireEvent.press(getByText('Send code'));
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('explains the disabled submit when the age checkbox is unticked', async () => {
    const { getByRole, findByText } = renderScreen(<PhoneScreen />, {
      route: { name: 'Phone', params: {} },
    });

    // Tick then untick: the ageConfirmed field validates on change and the
    // error must now be rendered under the checkbox (was silently swallowed).
    const checkbox = getByRole('checkbox');
    fireEvent.press(checkbox);
    fireEvent.press(checkbox);

    expect(
      await findByText('You must confirm you are at least 16 years old to continue.'),
    ).toBeTruthy();
  });

  it('shows the localized rate-limit message when send-otp returns 429', async () => {
    const requestOtp = jest.fn().mockRejectedValue({
      kind: 'rateLimited',
      status: 429,
      message: 'Too many requests, please try again later.',
    });
    useAuthStore.setState({ requestOtp });

    const { getByPlaceholderText, getByRole, getByText, navigation } = renderScreen(
      <PhoneScreen />,
      { route: { name: 'Phone', params: {} } },
    );

    fireEvent.changeText(getByPlaceholderText('+1 415 555 1234'), '4155551234');
    fireEvent.press(getByRole('checkbox'));

    await waitFor(() => {
      fireEvent.press(getByText('Send code'));
      expect(requestOtp).toHaveBeenCalled();
    });

    // The toast carries the localized generic, never the raw backend English.
    await waitFor(() => {
      expect(
        useToastStore
          .getState()
          .toasts.some(x => x.message === 'Too many attempts. Please try again in a moment.'),
      ).toBe(true);
    });
    expect(navigation.navigate).not.toHaveBeenCalledWith('Otp', expect.anything());
  });
});
