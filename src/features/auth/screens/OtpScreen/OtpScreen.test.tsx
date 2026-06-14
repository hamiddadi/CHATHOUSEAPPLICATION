import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { useAuthStore } from '../../store/authStore';
import { OtpScreen } from './OtpScreen';

const PHONE = '+14155551234';

/**
 * OtpScreen — needs a `phoneNumber` route param. Back arrow → goBack. The OTP
 * cells feed a hidden TextInput; entering 6 digits auto-submits via
 * store.verifyOtp (navigating to 'Name' for new users). The resend control is
 * gated behind a 60s countdown, so it's NOT pressable on mount — we assert the
 * countdown copy renders instead.
 */
describe('OtpScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts without throwing and shows the title (with phoneNumber param)', () => {
    const { getByText, toJSON } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE } },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Enter the code you received')).toBeTruthy();
  });

  it('goes back when the header back button is pressed', () => {
    const { navigation, getByLabelText } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE } },
    });
    fireEvent.press(getByLabelText('Close'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('shows the resend countdown (resend disabled on mount)', () => {
    const { queryByLabelText, getByText } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE } },
    });
    // Resend button is hidden until the countdown hits 0.
    expect(queryByLabelText('Resend code')).toBeNull();
    // The "resend in m:ss" copy is shown instead (starts at 1:00).
    expect(getByText(/1:00/)).toBeTruthy();
  });

  it('auto-submits via verifyOtp once 6 digits are entered and routes a new user to Name', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({ isNewUser: true });
    useAuthStore.setState({ verifyOtp });

    const { getByLabelText, navigation } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE } },
    });

    // The single hidden TextInput carries the whole code; the cells are decorative.
    const hiddenInput = getByLabelText('Verification code, 6 digits');
    fireEvent.changeText(hiddenInput, '123456');

    await waitFor(() => {
      expect(verifyOtp).toHaveBeenCalledWith(PHONE, '123456');
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Name', { phoneNumber: PHONE });
  });
});
