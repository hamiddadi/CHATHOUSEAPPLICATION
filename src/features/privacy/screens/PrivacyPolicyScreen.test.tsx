/**
 * Render-test for PrivacyPolicyScreen. This is a static legal document (no
 * route params, no queries, no buttons) built from <LegalDoc>. The test just
 * asserts it mounts without throwing and renders its real translated heading
 * and a few section titles, so a future i18n-key rename or LegalDoc regression
 * is caught.
 */
import React from 'react';
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
    expect(getByText('Last updated: April 25, 2026')).toBeTruthy();
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
});
