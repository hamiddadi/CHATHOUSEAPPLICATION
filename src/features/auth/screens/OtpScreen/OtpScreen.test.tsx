import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAuthStore } from '../../store/authStore';
import { OtpScreen } from './OtpScreen';

jest.mock('../../store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

const PHONE = '+33612345678';
const OTP_LABEL = 'Verification code, 6 digits';

interface StoreSlice {
  verifyOtp: jest.Mock;
  requestOtp: jest.Mock;
}

/**
 * The screen selects two functions from the store via `useAuthStore(s => s.x)`.
 * Mock the hook so it honours the selector against a controllable slice.
 */
const setupStore = (over: Partial<StoreSlice> = {}): StoreSlice => {
  const slice: StoreSlice = {
    verifyOtp: jest.fn().mockResolvedValue({ isNewUser: false }),
    requestOtp: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
  mockUseAuthStore.mockImplementation((selector?: (s: StoreSlice) => unknown) =>
    selector ? selector(slice) : slice,
  );
  return slice;
};

const renderOtp = (params: Record<string, unknown> = { phoneNumber: PHONE }) =>
  renderScreen(<OtpScreen />, { routeName: 'Otp', routeParams: params });

describe('OtpScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupStore();
  });

  it('renders the title, masked phone and OTP input', () => {
    renderOtp();
    expect(screen.getByText(i18n.t('auth.otp.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('auth.otp.sentTo', { phone: '+33 ••• ••• 678' }))).toBeTruthy();
    expect(screen.getByLabelText(OTP_LABEL)).toBeTruthy();
  });

  it('shows the resend countdown initially (resend disabled)', () => {
    renderOtp();
    expect(screen.getByText(i18n.t('auth.otp.resendIn', { time: '1:00' }))).toBeTruthy();
    expect(screen.queryByLabelText(i18n.t('auth.otp.resend'))).toBeNull();
  });

  it('verifies the code and navigates to Name for a new user', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({ isNewUser: true });
    setupStore({ verifyOtp });
    const { navigation } = renderOtp();

    fireEvent.changeText(screen.getByLabelText(OTP_LABEL), '123456');

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith(PHONE, '123456'));
    await waitFor(() =>
      expect(navigation.navigate).toHaveBeenCalledWith('Name', { phoneNumber: PHONE }),
    );
  });

  it('does not navigate to Name for an existing user', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({ isNewUser: false });
    setupStore({ verifyOtp });
    const { navigation } = renderOtp();

    fireEvent.changeText(screen.getByLabelText(OTP_LABEL), '654321');

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith(PHONE, '654321'));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('shows the invalid-code error and remaining attempts when verify fails', async () => {
    const verifyOtp = jest.fn().mockRejectedValue(new Error('bad code'));
    setupStore({ verifyOtp });
    renderOtp();

    fireEvent.changeText(screen.getByLabelText(OTP_LABEL), '000000');

    expect((await screen.findAllByText(i18n.t('auth.otp.errors.invalid'))).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText(i18n.t('auth.otp.attemptsRemaining', { count: 4 }))).toBeTruthy();
  });

  it('navigates back when the close button is pressed', () => {
    const { navigation } = renderOtp();
    fireEvent.press(screen.getByLabelText(i18n.t('common.close')));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
