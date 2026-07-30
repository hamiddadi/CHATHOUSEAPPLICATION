import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { useAuthStore } from '../../store/authStore';
import { OtpScreen } from './OtpScreen';

const PHONE = '+14155551234';
const LEGAL = {
  termsAccepted: true,
  privacyNoticeAcknowledged: true,
  legalDocumentVersion: '2026-07-29',
  legalLocale: 'en',
} as const;

/**
 * OtpScreen — needs a `phoneNumber` route param. Back arrow → goBack. The OTP
 * cells feed a hidden TextInput; entering 6 digits auto-submits via
 * store.verifyOtp (replacing to 'Name' for new users). Verify failures are
 * split on AppError.kind: transient (network/timeout/server/429) failures show
 * the transport message WITHOUT burning an attempt; only real code rejections
 * decrement the 5-attempt budget. The resend control is gated behind a 60s
 * countdown, so it's NOT pressable on mount.
 */
describe('OtpScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('mounts without throwing and shows the title (with phoneNumber param)', () => {
    const { getByText, toJSON } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE, legalAcceptance: LEGAL } },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Enter the code you received')).toBeTruthy();
  });

  it('goes back when the header back button is pressed', () => {
    const { navigation, getByLabelText } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE, legalAcceptance: LEGAL } },
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('shows the resend countdown (resend disabled on mount)', () => {
    const { queryByLabelText, getByText } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE, legalAcceptance: LEGAL } },
    });
    // Resend button is hidden until the countdown hits 0.
    expect(queryByLabelText('Resend code')).toBeNull();
    // The "resend in m:ss" copy is shown instead (starts at 1:00).
    expect(getByText(/1:00/)).toBeTruthy();
  });

  it('auto-submits via verifyOtp once 6 digits are entered and replaces to Name for a new user', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({ isNewUser: true });
    useAuthStore.setState({ verifyOtp });

    const { getByLabelText, navigation } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE, legalAcceptance: LEGAL } },
    });

    // The single hidden TextInput carries the whole code; the cells are decorative.
    const hiddenInput = getByLabelText('Verification code, 6 digits');
    fireEvent.changeText(hiddenInput, '123456');

    await waitFor(() => {
      expect(verifyOtp).toHaveBeenCalledWith(PHONE, '123456', LEGAL);
    });
    // `replace` (not `navigate`) so back from Name cannot land on a consumed OTP.
    expect(navigation.replace).toHaveBeenCalledWith('Name', { phoneNumber: PHONE });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('shows the network message and does NOT burn an attempt on a transient failure', async () => {
    const verifyOtp = jest.fn().mockRejectedValue({ kind: 'network', message: 'Network Error' });
    useAuthStore.setState({ verifyOtp });

    const { getByLabelText, findByText, queryByText } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE, legalAcceptance: LEGAL } },
    });

    fireEvent.changeText(getByLabelText('Verification code, 6 digits'), '123456');

    // Localized transport message (errorMessages.network), not "invalid code".
    expect(await findByText("We couldn't reach the server. Check your connection.")).toBeTruthy();
    expect(queryByText('Invalid code. 6 digits expected.')).toBeNull();
    // Attempt budget untouched → no "attempts remaining" warning.
    expect(queryByText(/remaining/)).toBeNull();
  });

  it('decrements the attempt budget on a real code rejection', async () => {
    const verifyOtp = jest
      .fn()
      .mockRejectedValue({ kind: 'auth', status: 401, message: 'Invalid or expired code' });
    useAuthStore.setState({ verifyOtp });

    const { getByLabelText, findByText, getByText } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE, legalAcceptance: LEGAL } },
    });

    fireEvent.changeText(getByLabelText('Verification code, 6 digits'), '123456');

    expect(await findByText('Invalid code. 6 digits expected.')).toBeTruthy();
    expect(getByText('4 attempts remaining')).toBeTruthy();
  });

  it('surfaces a visible localized error when the resend fails with 429', async () => {
    jest.useFakeTimers();
    const requestOtp = jest.fn().mockRejectedValue({
      kind: 'rateLimited',
      status: 429,
      message: 'Too many requests, please try again later.',
    });
    useAuthStore.setState({ requestOtp });

    const { getByText } = renderScreen(<OtpScreen />, {
      route: { name: 'Otp', params: { phoneNumber: PHONE, legalAcceptance: LEGAL } },
    });

    // Burn through the 60s cooldown so the resend button appears.
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    fireEvent.press(getByText('Resend code'));
    // Flush the rejected requestOtp promise.
    await act(async () => {
      await Promise.resolve();
    });

    expect(requestOtp).toHaveBeenCalledWith(PHONE, LEGAL);
    expect(getByText('Too many attempts. Please try again in a moment.')).toBeTruthy();
  });
});
