import React from 'react';
import { renderScreen, screen, fireEvent, waitFor, within } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAuthStore } from '../../store/authStore';
import { LandingScreen } from './LandingScreen';

// The screen reads two slices from the zustand auth store via selectors:
//   useAuthStore(s => s.devLogin) and useAuthStore(s => s.status).
// Mock the store so no real auth/network/token work runs; back it with a
// mutable state object and honour the selector calling convention.
jest.mock('../../store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

interface MockAuthState {
  status: string;
  devLogin: jest.Mock;
}

const setAuthState = (over: Partial<MockAuthState> = {}): MockAuthState => {
  const state: MockAuthState = {
    status: 'unauthenticated',
    devLogin: jest.fn().mockResolvedValue({ isNewUser: false }),
    ...over,
  };
  mockUseAuthStore.mockImplementation((selector?: (s: MockAuthState) => unknown) =>
    selector ? selector(state) : state,
  );
  return state;
};

describe('LandingScreen', () => {
  beforeEach(() => {
    mockUseAuthStore.mockReset();
    setAuthState();
  });

  it('renders the brand and tagline without crashing', () => {
    renderScreen(<LandingScreen />);
    expect(screen.getByText(i18n.t('common.appName'))).toBeTruthy();
    expect(screen.getByText(i18n.t('auth.landing.tagline'))).toBeTruthy();
  });

  it('renders the three feature rows', () => {
    renderScreen(<LandingScreen />);
    expect(screen.getByText(i18n.t('auth.landing.features.rooms.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('auth.landing.features.houses.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('auth.landing.features.chat.title'))).toBeTruthy();
  });

  it('navigates to Phone when the primary CTA is pressed', () => {
    const { navigation } = renderScreen(<LandingScreen />);
    fireEvent.press(screen.getByLabelText(i18n.t('auth.landing.cta.getStartedA11y')));
    expect(navigation.navigate).toHaveBeenCalledWith('Phone');
  });

  it('navigates to Phone when the secondary login CTA is pressed', () => {
    const { navigation } = renderScreen(<LandingScreen />);
    fireEvent.press(screen.getByLabelText(i18n.t('auth.landing.cta.loginA11y')));
    expect(navigation.navigate).toHaveBeenCalledWith('Phone');
  });

  it('calls devLogin when the dev-skip button is pressed', async () => {
    const state = setAuthState();
    renderScreen(<LandingScreen />);
    fireEvent.press(screen.getByLabelText(i18n.t('auth.landing.cta.devSkipA11y')));
    await waitFor(() => expect(state.devLogin).toHaveBeenCalledTimes(1));
  });

  it('shows the pending indicator on the dev-skip button while authenticating', () => {
    setAuthState({ status: 'authenticating' });
    renderScreen(<LandingScreen />);
    const devSkip = screen.getByLabelText(i18n.t('auth.landing.cta.devSkipA11y'));
    expect(within(devSkip).getByText('…')).toBeTruthy();
  });
});
