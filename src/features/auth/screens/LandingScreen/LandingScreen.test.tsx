import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { useAuthStore } from '../../store/authStore';
import { LandingScreen } from './LandingScreen';

/**
 * LandingScreen — pure presentational entry point. No route params, no query
 * data. Two primary CTAs ("Get started" / "Sign in") both navigate to 'Phone',
 * plus a dev-only "Skip auth" button (rendered because __DEV__ is true under
 * jest) that calls the store's devLogin().
 */
describe('LandingScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts without throwing and shows the primary CTAs', () => {
    const { getByLabelText, toJSON } = renderScreen(<LandingScreen />);
    expect(toJSON()).toBeTruthy();
    // a11y label for the "Get started" CTA (auth.landing.cta.getStartedA11y).
    expect(getByLabelText('Create an account')).toBeTruthy();
    expect(getByLabelText('Sign in')).toBeTruthy();
  });

  it('navigates to Phone when "Get started" is pressed', () => {
    const { navigation, getByLabelText } = renderScreen(<LandingScreen />);
    fireEvent.press(getByLabelText('Create an account'));
    expect(navigation.navigate).toHaveBeenCalledWith('Phone');
  });

  it('navigates to Phone when the login CTA is pressed', () => {
    const { navigation, getByLabelText } = renderScreen(<LandingScreen />);
    fireEvent.press(getByLabelText('Sign in'));
    expect(navigation.navigate).toHaveBeenCalledWith('Phone');
  });

  it('invokes devLogin from the dev-skip button without crashing', () => {
    // The dev-skip handler calls store.devLogin() (which would hit the network);
    // stub it so we only assert the wiring, not the API call.
    const devLogin = jest.fn().mockResolvedValue({ isNewUser: false });
    useAuthStore.setState({ devLogin });
    const { getByLabelText } = renderScreen(<LandingScreen />);
    fireEvent.press(getByLabelText('Sign in as devuser — development only'));
    expect(devLogin).toHaveBeenCalledTimes(1);
  });
});
