import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
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
import { colors, spacing } from '../../../../shared/constants/theme';
import type { AuthStackParamList } from '../../../../core/navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Otp'>;
type Route = RouteProp<AuthStackParamList, 'Otp'>;

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

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
  const { phoneNumber } = route.params;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN_SECONDS);
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

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  // Auto-submit when 6 digits entered
  const handleCodeChange = useCallback(
    async (newCode: string) => {
      setCode(newCode);
      setError(undefined);
      if (newCode.length === OTP_LENGTH) {
        setIsSubmitting(true);
        try {
          const { isNewUser } = await verifyOtp(phoneNumber, newCode);
          if (isNewUser) navigation.navigate('Username', { phoneNumber });
        } catch (err) {
          const msg =
            err && typeof err === 'object' && 'message' in err
              ? (err as { message: string }).message
              : t('auth.otp.errors.invalid');
          setError(msg);
          setAttempts(prev => prev + 1);
          triggerShake();
          setCode('');
        } finally {
          setIsSubmitting(false);
        }
      }
    },
    [navigation, phoneNumber, t, triggerShake, verifyOtp],
  );

  const handleResend = useCallback(async () => {
    if (countdown > 0 || isResending) return;
    setIsResending(true);
    try {
      await requestOtp(phoneNumber);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      setAttempts(0);
      setError(undefined);
      setCode('');
    } catch {
      // Silent — rate limit error surfaces via the store
    } finally {
      setIsResending(false);
    }
  }, [countdown, isResending, phoneNumber, requestOtp]);

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
          accessibilityLabel={t('common.close')}
          hitSlop={8}
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
          <OtpInput value={code} onChange={handleCodeChange} error={error} autoFocus />
        </Animated.View>

        {/* Remaining attempts warning */}
        {attempts > 0 && remainingAttempts > 0 && (
          <Text className="text-xs text-danger text-center">
            {t('auth.otp.attemptsRemaining', { count: remainingAttempts })}
          </Text>
        )}

        {/* Loading indicator during submit */}
        {isSubmitting && (
          <Text className="text-xs text-ink-muted text-center">{t('auth.otp.verifying')}</Text>
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
