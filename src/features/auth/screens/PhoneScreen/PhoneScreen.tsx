import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View, Keyboard } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { getLocales } from 'react-native-localize';
import { AsYouType, type CountryCode } from 'libphonenumber-js';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import {
  CountryPicker,
  COUNTRIES,
  type Country,
} from '../../../../shared/components/CountryPicker';
import { useFormApiErrors } from '../../../../shared/hooks/useFormApiErrors';
import { useAuthStore } from '../../store/authStore';
import { phoneFormSchema, type PhoneFormValues } from '../../schemas';
import { colors, spacing } from '../../../../shared/constants/theme';
import { legalDocumentVersion } from '../../../../config/env';
import type { AuthStackParamList } from '../../../../core/navigation/types';
import type { LegalAcceptancePayload } from '../../types/auth.types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Phone'>;

export const PhoneScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const requestOtp = useAuthStore(s => s.requestOtp);
  const { t, i18n } = useTranslation();

  const [countryPickerVisible, setCountryPickerVisible] = useState(false);

  const initialCountryCode = (getLocales()[0]?.countryCode as CountryCode) || 'US';
  const detectedCountry = (COUNTRIES.find(c => c.cca2 === initialCountryCode) ??
    COUNTRIES.find(c => c.cca2 === 'US') ??
    COUNTRIES[0]) as Country;

  const [selectedCountry, setSelectedCountry] = useState<Country>(detectedCountry);

  const {
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting, isValid },
  } = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneFormSchema),
    mode: 'onChange',
    defaultValues: {
      phoneNumber: detectedCountry.callingCode,
      ageConfirmed: false,
      termsAccepted: false,
      privacyNoticeAcknowledged: false,
    },
  });

  const handleApiError = useFormApiErrors(setError);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleTerms = useCallback(() => navigation.navigate('Terms'), [navigation]);
  const handlePrivacy = useCallback(() => navigation.navigate('PrivacyPolicy'), [navigation]);

  const onSubmit = useCallback(
    async ({ phoneNumber, termsAccepted, privacyNoticeAcknowledged }: PhoneFormValues) => {
      try {
        const legalAcceptance: LegalAcceptancePayload = {
          termsAccepted: termsAccepted as true,
          privacyNoticeAcknowledged: privacyNoticeAcknowledged as true,
          legalDocumentVersion,
          legalLocale: i18n.resolvedLanguage ?? i18n.language ?? 'en',
        };
        await requestOtp(phoneNumber, legalAcceptance);
        navigation.navigate('Otp', { phoneNumber, legalAcceptance });
      } catch (err) {
        handleApiError(err);
      }
    },
    [handleApiError, i18n.language, i18n.resolvedLanguage, navigation, requestOtp],
  );

  const handleSelectCountry = useCallback(
    (c: Country) => {
      setSelectedCountry(c);
      setValue('phoneNumber', c.callingCode, { shouldValidate: true });
    },
    [setValue],
  );

  const phoneFieldError = errors.phoneNumber?.message
    ? t(errors.phoneNumber.message as string)
    : undefined;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          hitSlop={12}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View
        className="flex-1 px-xxl gap-xxl"
        style={{ paddingBottom: insets.bottom + spacing.huge }}
      >
        <Text className="text-display font-display text-ink tracking-tight">
          {t('auth.phone.title', "What's your phone number?")}
        </Text>

        <Controller
          control={control}
          name="phoneNumber"
          render={({ field: { onChange, onBlur, value } }) => {
            const localRaw = value.startsWith(selectedCountry.callingCode)
              ? value.slice(selectedCountry.callingCode.length)
              : value;

            const formatter = new AsYouType(selectedCountry.cca2);
            const fullFormatted = formatter.input(selectedCountry.callingCode + localRaw);

            // eslint-disable-next-line security/detect-non-literal-regexp
            const prefixRegex = new RegExp(`^\\${selectedCountry.callingCode}\\s?`);
            const displayValue = fullFormatted.replace(prefixRegex, '');

            const handleTextChange = (text: string) => {
              const raw = text.replace(/[^\d]/g, '');
              onChange(selectedCountry.callingCode + raw);
            };

            return (
              <Input
                testID="auth-phone-input"
                placeholder={t('auth.phone.placeholder', 'Phone number')}
                value={displayValue}
                onChangeText={handleTextChange}
                onBlur={onBlur}
                keyboardType="phone-pad"
                autoFocus
                error={phoneFieldError}
                size="lg"
                leftAdornment={
                  <Pressable
                    testID="auth-country-selector"
                    onPress={() => {
                      Keyboard.dismiss();
                      setCountryPickerVisible(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.select_country', 'Select Country')}
                    accessibilityValue={{
                      text: `${selectedCountry.name} ${selectedCountry.callingCode}`,
                    }}
                    className="flex-row items-center px-sm gap-xs"
                  >
                    <Text className="text-xl">{selectedCountry.flag}</Text>
                    <Text className="text-body font-body-medium text-ink">
                      {selectedCountry.callingCode}
                    </Text>
                    <MaterialIcons name="arrow-drop-down" size={24} color={colors.text} />
                  </Pressable>
                }
              />
            );
          }}
        />

        <View className="flex-1" />

        <Controller
          control={control}
          name="ageConfirmed"
          render={({ field: { onChange, value } }) => (
            <Pressable
              testID="auth-age-confirmation"
              onPress={() => onChange(!value)}
              className="flex-row items-center gap-sm mb-md"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: value }}
            >
              <View
                className={`w-6 h-6 rounded border items-center justify-center ${
                  value ? 'bg-primary border-primary' : 'border-overlay-white-30 bg-transparent'
                }`}
              >
                {value && <MaterialIcons name="check" size={16} color="white" />}
              </View>
              <Text className="text-sm font-body-semibold text-ink flex-1">
                {t('auth.phone.ageVerification', 'I confirm I am at least 16 years old')}
              </Text>
            </Pressable>
          )}
        />

        {errors.ageConfirmed?.message && (
          <Text className="text-xs text-danger mb-md" accessibilityLiveRegion="polite">
            {t(
              errors.ageConfirmed.message as string,
              'You must confirm you are at least 16 years old to continue.',
            )}
          </Text>
        )}

        <Controller
          control={control}
          name="termsAccepted"
          render={({ field: { onChange, value } }) => (
            <View className="flex-row items-center gap-sm mb-sm">
              <Pressable
                testID="auth-terms-acceptance"
                onPress={() => onChange(!value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: value }}
                accessibilityLabel={t(
                  'auth.phone.termsAcceptance',
                  'I accept the current Terms of Use',
                )}
              >
                <View
                  className={`w-6 h-6 rounded border items-center justify-center ${
                    value ? 'bg-primary border-primary' : 'border-overlay-white-30 bg-transparent'
                  }`}
                >
                  {value && <MaterialIcons name="check" size={16} color="white" />}
                </View>
              </Pressable>
              <Text className="text-sm font-body-semibold text-ink flex-1">
                {t('auth.phone.termsAcceptancePrefix', 'I accept the ')}
                <Text
                  testID="auth-terms-link"
                  onPress={handleTerms}
                  accessibilityRole="link"
                  accessibilityLabel={t('auth.phone.termsLinkA11y', 'Terms of Service')}
                  className="text-primary font-body-medium"
                >
                  {t('auth.phone.termsLinkA11y', 'Terms of Service')}
                </Text>
                {t('auth.phone.legalVersion', ' (version {{version}})', {
                  version: legalDocumentVersion,
                })}
              </Text>
            </View>
          )}
        />

        {errors.termsAccepted?.message && (
          <Text className="text-xs text-danger mb-sm" accessibilityLiveRegion="polite">
            {t(
              errors.termsAccepted.message as string,
              'You must accept the current Terms of Use to continue.',
            )}
          </Text>
        )}

        <Controller
          control={control}
          name="privacyNoticeAcknowledged"
          render={({ field: { onChange, value } }) => (
            <View className="flex-row items-center gap-sm mb-md">
              <Pressable
                testID="auth-privacy-acknowledgement"
                onPress={() => onChange(!value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: value }}
                accessibilityLabel={t(
                  'auth.phone.privacyAcknowledgement',
                  'I acknowledge that I have read the Privacy Policy',
                )}
              >
                <View
                  className={`w-6 h-6 rounded border items-center justify-center ${
                    value ? 'bg-primary border-primary' : 'border-overlay-white-30 bg-transparent'
                  }`}
                >
                  {value && <MaterialIcons name="check" size={16} color="white" />}
                </View>
              </Pressable>
              <Text className="text-sm font-body-semibold text-ink flex-1">
                {t(
                  'auth.phone.privacyAcknowledgementPrefix',
                  'I acknowledge that I have read the ',
                )}
                <Text
                  testID="auth-privacy-link"
                  onPress={handlePrivacy}
                  accessibilityRole="link"
                  accessibilityLabel={t('auth.phone.privacyLinkA11y', 'Privacy Policy')}
                  className="text-primary font-body-medium"
                >
                  {t('auth.phone.privacyLinkA11y', 'Privacy Policy')}
                </Text>
                {t('auth.phone.privacyNotConsent', '. This is not consent to optional processing.')}
              </Text>
            </View>
          )}
        />

        {errors.privacyNoticeAcknowledged?.message && (
          <Text className="text-xs text-danger mb-md" accessibilityLiveRegion="polite">
            {t(
              errors.privacyNoticeAcknowledged.message as string,
              'Please acknowledge that you have read the Privacy Policy.',
            )}
          </Text>
        )}

        <Button
          testID="auth-phone-submit"
          label={t('auth.phone.submit', 'Next')}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!isValid || isSubmitting}
          loading={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        />
      </View>

      <CountryPicker
        visible={countryPickerVisible}
        onClose={() => setCountryPickerVisible(false)}
        onSelect={handleSelectCountry}
      />
    </KeyboardAvoidingView>
  );
};
