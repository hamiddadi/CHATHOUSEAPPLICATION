/**
 * Render-test for PrivacyPolicyScreen. This is a static legal document (no
 * route params, no queries, no buttons) built from <LegalDoc>. The test just
 * asserts it mounts without throwing and renders its real translated heading
 * and a few section titles, so a future i18n-key rename or LegalDoc regression
 * is caught.
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
    expect(getByText('Last updated: July 18, 2026')).toBeTruthy();
  });

  it('renders the numbered section headers', () => {
    const { getByText } = renderScreen(<PrivacyPolicyScreen />);
    expect(getByText('1. What data we collect')).toBeTruthy();
    expect(getByText('5. Your rights (GDPR)')).toBeTruthy();
    expect(getByText('7. Contact')).toBeTruthy();
  });

  it('renders the contact e-mail address', () => {
    const { getByText } = renderScreen(<PrivacyPolicyScreen />);
    expect(getByText('privacy@chathouse.app')).toBeTruthy();
  });

  it('opens a mailto: link when the contact e-mail is tapped', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByText } = renderScreen(<PrivacyPolicyScreen />);
    fireEvent.press(getByText('privacy@chathouse.app'));
    expect(openSpy).toHaveBeenCalledWith('mailto:privacy@chathouse.app');
  });

  it('returns through the explicit legal-document back control', () => {
    const { navigation, getByTestId } = renderScreen(<PrivacyPolicyScreen />);
    fireEvent.press(getByTestId('privacy-policy-screen-back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
