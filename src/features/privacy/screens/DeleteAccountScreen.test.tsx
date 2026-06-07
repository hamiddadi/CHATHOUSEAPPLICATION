import React from 'react';
import { Alert } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAuthStore } from '../../auth/store/authStore';
import { privacyService } from '../services/privacyService';
import { DeleteAccountScreen } from './DeleteAccountScreen';

// The real authStore module pulls in services, push, livekit and several
// cross-feature stores at import time. Replace it with a minimal selector-aware
// mock so no native / network work happens and we control `signOut`.
jest.mock('../../auth/store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

// privacyService hits apiClient (network). Stub the one method this screen calls.
jest.mock('../services/privacyService', () => ({
  privacyService: {
    requestDeletion: jest.fn().mockResolvedValue({
      deletedAt: '2026-06-06T00:00:00.000Z',
      permanentDeletionAt: '2026-07-06T00:00:00.000Z',
    }),
  },
}));

const mockUseAuthStore = useAuthStore as unknown as jest.Mock;
const mockRequestDeletion = privacyService.requestDeletion as jest.Mock;

let signOut: jest.Mock;

const wireStore = () => {
  const state = { signOut };
  mockUseAuthStore.mockImplementation((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
};

describe('DeleteAccountScreen', () => {
  beforeEach(() => {
    signOut = jest.fn().mockResolvedValue(undefined);
    mockUseAuthStore.mockReset();
    mockRequestDeletion.mockClear();
    mockRequestDeletion.mockResolvedValue({
      deletedAt: '2026-06-06T00:00:00.000Z',
      permanentDeletionAt: '2026-07-06T00:00:00.000Z',
    });
    wireStore();
  });

  it('renders the title and the destructive delete button', () => {
    renderScreen(<DeleteAccountScreen />);

    expect(screen.getByText(i18n.t('privacy.delete.title'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: i18n.t('privacy.delete.buttonDelete') }),
    ).toBeTruthy();
  });

  it('renders the confirmation input and grace-period warning', () => {
    renderScreen(<DeleteAccountScreen />);

    expect(screen.getByLabelText(i18n.t('privacy.delete.a11yInput'))).toBeTruthy();
    expect(screen.getByText(i18n.t('privacy.delete.grace'))).toBeTruthy();
  });

  it('keeps the delete button disabled until the confirm phrase is typed', () => {
    renderScreen(<DeleteAccountScreen />);

    const button = screen.getByRole('button', { name: i18n.t('privacy.delete.buttonDelete') });
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('enables the delete button once the confirm phrase is typed', async () => {
    renderScreen(<DeleteAccountScreen />);

    fireEvent.changeText(
      screen.getByLabelText(i18n.t('privacy.delete.a11yInput')),
      i18n.t('privacy.delete.confirmPhrase'),
    );

    const button = screen.getByRole('button', { name: i18n.t('privacy.delete.buttonDelete') });
    await waitFor(() => {
      expect(button.props.accessibilityState?.disabled).toBe(false);
    });
  });

  it('opens a confirmation alert when the enabled delete button is pressed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderScreen(<DeleteAccountScreen />);

    fireEvent.changeText(
      screen.getByLabelText(i18n.t('privacy.delete.a11yInput')),
      i18n.t('privacy.delete.confirmPhrase'),
    );

    const button = screen.getByRole('button', { name: i18n.t('privacy.delete.buttonDelete') });
    await waitFor(() => {
      expect(button.props.accessibilityState?.disabled).toBe(false);
    });

    fireEvent.press(button);

    expect(alertSpy).toHaveBeenCalledWith(
      i18n.t('privacy.delete.title'),
      expect.any(String),
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });

  it('requests deletion and signs out when the destructive alert action is confirmed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderScreen(<DeleteAccountScreen />);

    fireEvent.changeText(
      screen.getByLabelText(i18n.t('privacy.delete.a11yInput')),
      i18n.t('privacy.delete.confirmPhrase'),
    );

    const button = screen.getByRole('button', { name: i18n.t('privacy.delete.buttonDelete') });
    await waitFor(() => {
      expect(button.props.accessibilityState?.disabled).toBe(false);
    });

    fireEvent.press(button);

    // Invoke the destructive button's onPress from the alert button array.
    const buttons = alertSpy.mock.calls[0]?.[2] as
      | { style?: string; onPress?: () => void | Promise<void> }[]
      | undefined;
    const destructive = buttons?.find(b => b.style === 'destructive');
    await destructive?.onPress?.();

    await waitFor(() => {
      expect(mockRequestDeletion).toHaveBeenCalledTimes(1);
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });
});
