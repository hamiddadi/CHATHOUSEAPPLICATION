import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { useAuthStore } from '../../store/authStore';
import { PhoneScreen } from './PhoneScreen';

/**
 * PhoneScreen — phone-number entry. Back arrow → goBack; Terms / Privacy text
 * links → navigate('Terms'|'PrivacyPolicy'); the "Send code" submit is disabled
 * until the RHF form is valid (a well-formed E.164 number AND the age checkbox).
 * Submitting calls store.requestOtp then navigates to 'Otp'.
 */
describe('PhoneScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
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
    fireEvent.press(getByLabelText('Close'));
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
});
