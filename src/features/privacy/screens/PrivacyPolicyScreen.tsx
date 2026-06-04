import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  LegalDoc,
  LegalEmail,
  LegalParagraph as P,
  LegalSection as Section,
} from '../components/LegalDoc';

/**
 * Static privacy policy. Kept in-app rather than as a remote URL so it
 * works offline and the version reviewed at build time matches what the
 * user sees. Update this file alongside any data-handling change.
 */
export const PrivacyPolicyScreen: React.FC = () => {
  const { t } = useTranslation();
  return (
    <LegalDoc title={t('privacy.policy.title')} lastUpdated={t('privacy.policy.lastUpdated')}>
      <Section title={t('privacy.policy.s1.title')}>
        <P>{t('privacy.policy.s1.p1')}</P>
        <P>{t('privacy.policy.s1.p2')}</P>
        <P>{t('privacy.policy.s1.p3')}</P>
        <P>{t('privacy.policy.s1.p4')}</P>
        <P>{t('privacy.policy.s1.p5')}</P>
      </Section>

      <Section title={t('privacy.policy.s2.title')}>
        <P>{t('privacy.policy.s2.p1')}</P>
        <P>{t('privacy.policy.s2.p2')}</P>
        <P>{t('privacy.policy.s2.p3')}</P>
        <P>{t('privacy.policy.s2.p4')}</P>
      </Section>

      <Section title={t('privacy.policy.s3.title')}>
        <P>{t('privacy.policy.s3.p1')}</P>
        <P>{t('privacy.policy.s3.p2')}</P>
        <P>{t('privacy.policy.s3.p3')}</P>
      </Section>

      <Section title={t('privacy.policy.s4.title')}>
        <P>{t('privacy.policy.s4.p1')}</P>
        <P>{t('privacy.policy.s4.p2')}</P>
        <P>{t('privacy.policy.s4.p3')}</P>
        <P>{t('privacy.policy.s4.p4')}</P>
      </Section>

      <Section title={t('privacy.policy.s5.title')}>
        <P>{t('privacy.policy.s5.p1')}</P>
        <P>{t('privacy.policy.s5.p2')}</P>
        <P>{t('privacy.policy.s5.p3')}</P>
        <P>{t('privacy.policy.s5.p4')}</P>
        <P>{t('privacy.policy.s5.p5')}</P>
      </Section>

      <Section title={t('privacy.policy.s6.title')}>
        <P>{t('privacy.policy.s6.p1')}</P>
        <P>{t('privacy.policy.s6.p2')}</P>
        <P>{t('privacy.policy.s6.p3')}</P>
      </Section>

      <Section title={t('privacy.policy.s7.title')}>
        <P>
          {t('privacy.policy.s7.p1')}
          <LegalEmail>privacy@chathouse.app</LegalEmail>
        </P>
      </Section>
    </LegalDoc>
  );
};
