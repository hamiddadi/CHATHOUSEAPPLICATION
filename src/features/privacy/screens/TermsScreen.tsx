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

export const TermsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { t, i18n } = useTranslation();
  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  return (
    <LegalDoc
      testID="terms-screen"
      title={t('privacy.terms.title')}
      lastUpdated={t('privacy.terms.lastUpdated', { version: legalDocumentVersion })}
      onBack={handleBack}
      backLabel={t('common.back', 'Back')}
    >
      <P>
        {t('privacy.terms.fullNotice')}{' '}
        <LegalLink url={localizedLegalUrl(legalUrls.terms, i18n.resolvedLanguage ?? i18n.language)}>
          {t('privacy.terms.fullLink')}
        </LegalLink>
      </P>

      <Section title={t('privacy.terms.s1.title')}>
        <P>{t('privacy.terms.s1.p1')}</P>
      </Section>

      <Section title={t('privacy.terms.s2.title')}>
        <P>{t('privacy.terms.s2.p1')}</P>
        <P>{t('privacy.terms.s2.p2')}</P>
        <P>{t('privacy.terms.s2.p3')}</P>
      </Section>

      <Section title={t('privacy.terms.s3.title')}>
        <P>{t('privacy.terms.s3.p1')}</P>
        <P>{t('privacy.terms.s3.p2')}</P>
        <P>{t('privacy.terms.s3.p3')}</P>
        <P>{t('privacy.terms.s3.p4')}</P>
        <P>{t('privacy.terms.s3.p5')}</P>
      </Section>

      <Section title={t('privacy.terms.s4.title')}>
        <P>{t('privacy.terms.s4.p1')}</P>
        <P>{t('privacy.terms.s4.p2')}</P>
      </Section>

      <Section title={t('privacy.terms.s5.title')}>
        <P>{t('privacy.terms.s5.p1')}</P>
        <P>{t('privacy.terms.s5.p2')}</P>
      </Section>

      <Section title={t('privacy.terms.s6.title')}>
        <P>{t('privacy.terms.s6.p1')}</P>
      </Section>

      <Section title={t('privacy.terms.s7.title')}>
        <P>{t('privacy.terms.s7.p1')}</P>
      </Section>

      <Section title={t('privacy.terms.s8.title')}>
        <P>{t('privacy.terms.s8.p1')}</P>
      </Section>
    </LegalDoc>
  );
};
