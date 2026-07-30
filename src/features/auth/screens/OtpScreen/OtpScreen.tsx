import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { OtpInput } from '../../../../shared/components/OtpInput';
import { useAuthStore } from '../../store/authStore';
import {
  messageByKind,
  toAppError,
  type AppError,
} from '../../../../shared/services/api/errorHandler';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { AuthStackParamList } from '../../../../core/navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Otp'>;
type Route = RouteProp<AuthStackParamList, 'Otp'>;

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

/**
 * Failure kinds that never mean "wrong code": the request didn't reach a
 * verdict (offline, 5xx, timeout) or was throttled (429). Those show the
 * localized transport message and do NOT burn an attempt.
 */
const TRANSIENT_KINDS: ReadonlySet<AppError['kind']> = new Set([
  'network',
  'timeout',
  'server',
  'rateLimited',
]);

/** Mask a phone number: +33612345678 → +33 ••• ••• 678 */
const maskPhone = (phone: string): string => {
  if (phone.length < 6) return phone;
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-3);
  return `${prefix} ••• ••• ${suffix}`;
};

export const OtpScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const verifyOtp = useAuthStore(s => s.verifyOtp);
  const requestOtp = useAuthStore(s => s.requestOtp);
  const { t } = useTranslation();
  const { phoneNumber, legalAcceptance } = route.params;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN_SECONDS);
  const [isCounting, setIsCounting] = useState(true);
  const [isResending, setIsResending] = useState(false);

  // Shake animation on error
  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  const triggerShake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-4, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [shakeX]);

  // Countdown timer for resend. Depend on `isCounting` (a stable boolean)
  // rather than `countdown` so the interval is created once per cooldown
  // instead of being torn down and recreated on every tick.
  useEffect(() => {
    if (!isCounting) return;
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          setIsCounting(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isCounting]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const locked = attempts >= MAX_ATTEMPTS;

  // Auto-submit when 6 digits entered
  const handleCodeChange = useCallback(
    async (newCode: string) => {
      // A verify is already in flight — swallow extra input until it settles
      // so a fast paste/typo can't double-submit the same code.
      if (isSubmitting) return;
      // Once the attempt budget is exhausted, stop accepting submissions
      // client-side (backend also rate-limits). The user must resend a code,
      // which resets `attempts` below.
      if (locked) {
        setError(t('auth.otp.errors.tooManyAttempts', 'Too many attempts. Resend a new code.'));
        return;
      }
      setCode(newCode);
      setError(undefined);
      if (newCode.length === OTP_LENGTH) {
        setIsSubmitting(true);
        try {
          const { isNewUser } = await verifyOtp(phoneNumber, newCode, legalAcceptance);
          // New users pick a real name first (Clubhouse order), then a
          // username. `replace` (not `navigate`) so backing out of Name lands
          // on Phone instead of this already-consumed OTP.
          if (isNewUser) navigation.replace('Name', { phoneNumber });
        } catch (err) {
          const e = toAppError(err);
          if (TRANSIENT_KINDS.has(e.kind)) {
            // The code was never judged wrong — show the localized transport
            // message and keep the attempt budget intact. Clearing the code
            // lets a re-entry re-trigger the auto-submit.
            setError(messageByKind(e.kind));
            setCode('');
          } else {
            // Auth/validation failure = wrong/expired code. Show the localized
            // message instead of leaking the raw HTTP error string; the attempt
            // budget + "too many attempts" copy are tracked/surfaced separately.
            setError(t('auth.otp.errors.invalid'));
            setAttempts(prev => prev + 1);
            triggerShake();
            setCode('');
          }
        } finally {
          setIsSubmitting(false);
        }
      }
    },
    [isSubmitting, legalAcceptance, locked, navigation, phoneNumber, t, triggerShake, verifyOtp],
  );

  const handleResend = useCallback(async () => {
    if (countdown > 0 || isResending) return;
    setIsResending(true);
    try {
      await requestOtp(phoneNumber, legalAcceptance);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      setIsCounting(true);
      setAttempts(0);
      setError(undefined);
      setCode('');
    } catch (err) {
      // Surface the failure — a silent catch left users believing a new code
      // was sent. 429 gets its dedicated localized message.
      const e = toAppError(err);
      setError(
        e.kind === 'rateLimited'
          ? messageByKind('rateLimited')
          : t('auth.otp.errors.resendFailed', "We couldn't resend the code. Try again."),
      );
    } finally {
      setIsResending(false);
    }
  }, [countdown, isResending, legalAcceptance, phoneNumber, requestOtp, t]);

  const remainingAttempts = MAX_ATTEMPTS - attempts;
  const canResend = countdown === 0 && !isResending;
  const formatCountdown = `${Math.floor(countdown / 60)}:${(countdown % 60).toString().padStart(2, '0')}`;

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
          {t('auth.otp.title')}
        </Text>

        {/* Masked phone number display */}
        <Text className="text-md text-ink-muted text-center">
          {t('auth.otp.sentTo', { phone: maskPhone(phoneNumber) })}
        </Text>

        {/* 6-cell OTP input with shake animation */}
        <Animated.View style={shakeStyle}>
          <OtpInput
            testID="auth-otp-input"
            value={code}
            onChange={handleCodeChange}
            error={error}
            autoFocus
            accessibilityLabel={t('auth.otp.inputA11yLabel', {
              defaultValue: 'Verification code, {{length}} digits',
              length: OTP_LENGTH,
            })}
            accessibilityHint={t(
              'auth.otp.inputA11yHint',
              'Enter the code you received by text message.',
            )}
          />
        </Animated.View>

        {/* Remaining attempts warning */}
        {attempts > 0 && remainingAttempts > 0 && (
          <Text className="text-xs text-danger text-center" accessibilityLiveRegion="assertive">
            {t('auth.otp.attemptsRemaining', { count: remainingAttempts })}
          </Text>
        )}

        {/* Locked: too many attempts — invite a resend */}
        {locked && (
          <Text className="text-xs text-danger text-center" accessibilityLiveRegion="polite">
            {t('auth.otp.errors.tooManyAttempts', 'Too many attempts. Resend a new code.')}
          </Text>
        )}

        {/* Loading indicator during submit */}
        {isSubmitting && (
          <Text className="text-xs text-ink-muted text-center" accessibilityLiveRegion="polite">
            {t('auth.otp.verifying')}
          </Text>
        )}

        {/* Resend with countdown */}
        <View className="items-center gap-xs">
          {canResend ? (
            <Pressable
              onPress={handleResend}
              accessibilityRole="button"
              accessibilityLabel={t('auth.otp.resend')}
            >
              <Text className="text-sm font-body-bold text-primary">{t('auth.otp.resend')}</Text>
            </Pressable>
          ) : (
            <Text className="text-sm font-body text-ink-dim">
              {t('auth.otp.resendIn', { time: formatCountdown })}
            </Text>
          )}
        </View>

        <View className="flex-1" />
      </View>
    </KeyboardAvoidingView>
  );
};
