import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { AuthStackParamList } from '../../../../core/navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Otp'>;
type Route = RouteProp<AuthStackParamList, 'Otp'>;

const OTP_LENGTH = 6;

export const OtpScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const verifyOtp = useAuthStore(s => s.verifyOtp);

  const { phoneNumber } = route.params;

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleVerify = useCallback(async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const { isNewUser } = await verifyOtp(phoneNumber, code);
      if (isNewUser) {
        navigation.navigate('Username', { phoneNumber });
      }
    } catch {
      setError('Invalid code. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [code, navigation, phoneNumber, verifyOtp]);

  const canSubmit = code.length === OTP_LENGTH;

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
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View
        className="flex-1 px-xxl gap-xxl"
        style={{ paddingBottom: insets.bottom + spacing.huge }}
      >
        <View className="gap-sm">
          <Text className="text-display font-display text-ink tracking-tight">Enter the code</Text>
          <Text className="text-sm font-body text-ink-muted">
            We sent a {OTP_LENGTH}-digit code to {phoneNumber}.
          </Text>
        </View>

        <Input
          placeholder="123456"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          autoFocus
          error={error ?? undefined}
          size="lg"
        />

        <Pressable accessibilityRole="button" accessibilityLabel="Resend code">
          <Text className="text-sm font-body-bold text-primary">
            Didn&apos;t get a code? Resend
          </Text>
        </Pressable>

        <View className="flex-1" />

        <Button
          label="Verify"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={isSubmitting}
          onPress={handleVerify}
        />
      </View>
    </KeyboardAvoidingView>
  );
};
