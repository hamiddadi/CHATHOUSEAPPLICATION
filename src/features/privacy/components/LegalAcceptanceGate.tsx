import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { legalDocumentVersion } from '../../../config/env';
import { colors } from '../../../shared/constants/theme';
import { useAuthStore } from '../../auth/store/authStore';
import { legalUrls } from '../legalUrls';

/**
 * Fail-closed gate for returning users whose stored Terms version is absent or
 * stale. The Privacy Notice acknowledgement is shown as a separate statement:
 * it proves presentation/read acknowledgement and is not described as consent.
 */
export const LegalAcceptanceGate: React.FC = () => {
  const { t, i18n } = useTranslation();
  const status = useAuthStore(state => state.status);
  const required = useAuthStore(state => state.user?.legalAcceptanceRequired === true);
  const acceptLegalDocuments = useAuthStore(state => state.acceptLegalDocuments);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!required) {
      setTermsAccepted(false);
      setPrivacyAcknowledged(false);
      setSubmitting(false);
    }
  }, [required]);

  const open = useCallback(
    (url: string) => {
      void Linking.openURL(url).catch(() => {
        Alert.alert(
          t('privacy.legalGate.linkErrorTitle', 'Unable to open document'),
          t('privacy.legalGate.linkErrorBody', 'Check your connection and try again.'),
        );
      });
    },
    [t],
  );

  const submit = useCallback(async () => {
    if (!termsAccepted || !privacyAcknowledged || submitting) return;
    setSubmitting(true);
    try {
      await acceptLegalDocuments({
        termsAccepted: true,
        privacyNoticeAcknowledged: true,
        legalDocumentVersion,
        legalLocale: i18n.resolvedLanguage ?? i18n.language ?? 'en',
      });
    } catch {
      Alert.alert(
        t('privacy.legalGate.errorTitle', 'Acceptance not saved'),
        t(
          'privacy.legalGate.errorBody',
          'We could not save your acknowledgement. Update the app or try again.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    acceptLegalDocuments,
    i18n.language,
    i18n.resolvedLanguage,
    privacyAcknowledged,
    submitting,
    t,
    termsAccepted,
  ]);

  const visible = status === 'authenticated' && required;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={() => undefined}
      testID="legal-acceptance-gate"
    >
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 px-xxl py-huge justify-center gap-xl">
          <View className="gap-sm">
            <Text className="text-display font-display text-ink">
              {t('privacy.legalGate.title', 'Review required')}
            </Text>
            <Text className="text-sm text-ink-muted leading-5">
              {t(
                'privacy.legalGate.body',
                'Before publishing or speaking, review the current legal documents (version {{version}}).',
                { version: legalDocumentVersion },
              )}
            </Text>
          </View>

          <View className="gap-lg">
            <View className="flex-row items-center gap-sm">
              <Pressable
                testID="legal-gate-terms-checkbox"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: termsAccepted }}
                accessibilityLabel={t(
                  'privacy.legalGate.acceptTerms',
                  'I accept the current Terms of Use',
                )}
                onPress={() => setTermsAccepted(value => !value)}
              >
                <View
                  className={`w-7 h-7 rounded border items-center justify-center ${
                    termsAccepted
                      ? 'bg-primary border-primary'
                      : 'border-overlay-white-30 bg-transparent'
                  }`}
                >
                  {termsAccepted && (
                    <MaterialIcons name="check" size={18} color={colors.onPrimary} />
                  )}
                </View>
              </Pressable>
              <Pressable
                className="flex-1"
                accessibilityRole="link"
                onPress={() => open(legalUrls.terms)}
              >
                <Text className="text-sm text-primary font-body-semibold">
                  {t('privacy.legalGate.acceptTerms', 'I accept the current Terms of Use')}
                </Text>
              </Pressable>
            </View>

            <View className="flex-row items-center gap-sm">
              <Pressable
                testID="legal-gate-privacy-checkbox"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: privacyAcknowledged }}
                accessibilityLabel={t(
                  'privacy.legalGate.ackPrivacy',
                  'I acknowledge that I have read the Privacy Policy',
                )}
                onPress={() => setPrivacyAcknowledged(value => !value)}
              >
                <View
                  className={`w-7 h-7 rounded border items-center justify-center ${
                    privacyAcknowledged
                      ? 'bg-primary border-primary'
                      : 'border-overlay-white-30 bg-transparent'
                  }`}
                >
                  {privacyAcknowledged && (
                    <MaterialIcons name="check" size={18} color={colors.onPrimary} />
                  )}
                </View>
              </Pressable>
              <Pressable
                className="flex-1"
                accessibilityRole="link"
                onPress={() => open(legalUrls.privacy)}
              >
                <Text className="text-sm text-primary font-body-semibold">
                  {t(
                    'privacy.legalGate.ackPrivacy',
                    'I acknowledge that I have read the Privacy Policy',
                  )}
                </Text>
                <Text className="text-xs text-ink-muted mt-xs">
                  {t(
                    'privacy.legalGate.notConsent',
                    'This acknowledgement is not consent to optional processing.',
                  )}
                </Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            testID="legal-gate-submit"
            accessibilityRole="button"
            accessibilityState={{
              disabled: !termsAccepted || !privacyAcknowledged || submitting,
            }}
            disabled={!termsAccepted || !privacyAcknowledged || submitting}
            onPress={submit}
            className={`rounded-full py-lg items-center ${
              termsAccepted && privacyAcknowledged ? 'bg-primary' : 'bg-overlay-white-10'
            }`}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text
                className={`text-md font-body-bold ${
                  termsAccepted && privacyAcknowledged ? 'text-primary-on' : 'text-ink-muted'
                }`}
              >
                {t('privacy.legalGate.continue', 'Accept and continue')}
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
};
