import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { AuthStackParamList } from '../../../../core/navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Phone'>;

const PHONE_REGEX = /^\+?[0-9\s\-()]{6,20}$/;

export const PhoneScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requestOtp = useAuthStore(s => s.requestOtp);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleSubmit = useCallback(async () => {
    if (!PHONE_REGEX.test(phoneNumber.trim())) {
      setError('Enter a valid phone number.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await requestOtp(phoneNumber.trim());
      navigation.navigate('Otp', { phoneNumber: phoneNumber.trim() });
    } catch {
      setError('Could not send the code. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [navigation, phoneNumber, requestOtp]);

  const isValid = PHONE_REGEX.test(phoneNumber.trim());

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
          <Text className="text-display font-display text-ink tracking-tight">
            Enter your phone number
          </Text>
          <Text className="text-sm font-body text-ink-muted">
            We&apos;ll send you a verification code by SMS.
          </Text>
        </View>

        <Input
          label="Phone number"
          placeholder="+33 6 12 34 56 78"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
          autoFocus
          error={error ?? undefined}
          size="lg"
        />

        <View className="flex-1" />

        <Button
          label="Send code"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!isValid}
          loading={isSubmitting}
          onPress={handleSubmit}
        />
      </View>
    </KeyboardAvoidingView>
  );
};
