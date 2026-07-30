import React, { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { legalDocumentVersion } from '../../../config/env';
import {
  LegalDoc,
  LegalLink,
  LegalParagraph as P,
  LegalSection as Section,
} from '../components/LegalDoc';
import { legalUrls, localizedLegalUrl } from '../legalUrls';

/**
 * Offline privacy summary plus a link to the canonical published policy.
 * Update the summary and its build-time version whenever the canonical document
 * changes.
 */
export const PrivacyPolicyScreen: React.FC = () => {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  return (
    <LegalDoc
      testID="privacy-policy-screen"
      title={t('privacy.policy.title')}
      lastUpdated={t('privacy.policy.lastUpdated', { version: legalDocumentVersion })}
      onBack={handleBack}
      backLabel={t('common.back', 'Back')}
    >
      <P>
        {t('privacy.policy.fullNotice')}{' '}
        <LegalLink
          url={localizedLegalUrl(legalUrls.privacy, i18n.resolvedLanguage ?? i18n.language)}
        >
          {t('privacy.policy.fullLink')}
        </LegalLink>
      </P>

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
          {t('privacy.policy.s7.p1')}{' '}
          <LegalLink
            url={localizedLegalUrl(legalUrls.privacy, i18n.resolvedLanguage ?? i18n.language)}
          >
            {t('privacy.policy.s7.link')}
          </LegalLink>
        </P>
      </Section>
    </LegalDoc>
  );
};
