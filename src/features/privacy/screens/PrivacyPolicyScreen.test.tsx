/**
 * Render-test for PrivacyPolicyScreen. This is a static legal document built
 * from <LegalDoc>. It also exposes explicit back, mailto and canonical-policy
 * links.
 */
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { PrivacyPolicyScreen } from './PrivacyPolicyScreen';

describe('PrivacyPolicyScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders the policy title + last-updated line', () => {
    const { getByText, toJSON } = renderScreen(<PrivacyPolicyScreen />);
    expect(toJSON()).toBeTruthy();
    expect(getByText('Privacy Policy')).toBeTruthy();
    expect(getByText('Document version: 2026-07-29')).toBeTruthy();
  });

  it('renders the numbered section headers', () => {
    const { getByText } = renderScreen(<PrivacyPolicyScreen />);
    expect(getByText('1. What data we collect')).toBeTruthy();
    expect(getByText('5. Your rights (GDPR)')).toBeTruthy();
    expect(getByText('7. Contact')).toBeTruthy();
  });

  it('opens the canonical complete Privacy Policy link', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByText } = renderScreen(<PrivacyPolicyScreen />);
    fireEvent.press(getByText('Read the complete policy'));
    expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/\/privacy$/u));
  });

  it('returns through the explicit legal-document back control', () => {
    const { navigation, getByTestId } = renderScreen(<PrivacyPolicyScreen />);
    fireEvent.press(getByTestId('privacy-policy-screen-back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
