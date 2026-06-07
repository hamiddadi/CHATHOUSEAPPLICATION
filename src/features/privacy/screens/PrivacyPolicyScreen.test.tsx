import React from 'react';
import { renderScreen, screen } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { PrivacyPolicyScreen } from './PrivacyPolicyScreen';

/**
 * PrivacyPolicyScreen is a static, in-app legal document with no data
 * fetching, navigation, or interactive controls — it only renders i18n
 * strings inside the shared LegalDoc layout. Tests therefore assert that the
 * heading, "last updated" line, every section title, and the contact e-mail
 * are present, using real EN i18n values so the assertions stay robust.
 */
describe('PrivacyPolicyScreen', () => {
  it('renders without crashing and shows the document heading', () => {
    renderScreen(<PrivacyPolicyScreen />);
    expect(screen.getByText(i18n.t('privacy.policy.title'))).toBeTruthy();
  });

  it('shows the "last updated" line', () => {
    renderScreen(<PrivacyPolicyScreen />);
    expect(screen.getByText(i18n.t('privacy.policy.lastUpdated'))).toBeTruthy();
  });

  it('renders all seven section titles', () => {
    renderScreen(<PrivacyPolicyScreen />);
    const sectionKeys = [
      'privacy.policy.s1.title',
      'privacy.policy.s2.title',
      'privacy.policy.s3.title',
      'privacy.policy.s4.title',
      'privacy.policy.s5.title',
      'privacy.policy.s6.title',
      'privacy.policy.s7.title',
    ];
    sectionKeys.forEach(key => {
      expect(screen.getByText(i18n.t(key))).toBeTruthy();
    });
  });

  it('renders body paragraphs from the data-collection section', () => {
    renderScreen(<PrivacyPolicyScreen />);
    expect(screen.getByText(i18n.t('privacy.policy.s1.p1'))).toBeTruthy();
    expect(screen.getByText(i18n.t('privacy.policy.s5.p5'))).toBeTruthy();
  });

  it('shows the contact e-mail address', () => {
    renderScreen(<PrivacyPolicyScreen />);
    expect(screen.getByText('privacy@chathouse.app')).toBeTruthy();
  });
});
