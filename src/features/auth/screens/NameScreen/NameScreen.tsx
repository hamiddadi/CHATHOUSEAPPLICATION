import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { AuthStackParamList } from '../../../../core/navigation/types';
import { useOnboardingStore } from '../../../onboarding/store/onboardingStore';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Name'>;
type Route = RouteProp<AuthStackParamList, 'Name'>;

const NAME_MAX = 50;

/**
 * Real-name step. Clubhouse collects the user's name BEFORE the @username, so
 * identity is anchored on a real name. We stash it in the onboarding store
 * (the user is authenticated post-OTP but the Auth stack is intentionally kept
 * mounted via status:'authenticating' until setUsername) and it flushes to the
 * API at completeOnboarding alongside the rest of the profile.
 */
export const NameScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const setProfile = useOnboardingStore(s => s.setProfile);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const canContinue = firstName.trim().length > 0;

  const handleNext = useCallback(() => {
    setProfile({
      firstName: firstName.trim() || undefined,
      lastName: lastName.trim() || undefined,
    });
    navigation.navigate('Username', { phoneNumber: route.params.phoneNumber });
  }, [firstName, lastName, navigation, route.params.phoneNumber, setProfile]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

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
          accessibilityLabel={t('common.close', 'Back')}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View
        className="flex-1 px-xxl gap-xxl"
        style={{ paddingBottom: insets.bottom + spacing.huge }}
      >
        <View className="gap-md">
          <Text className="text-display font-display text-ink tracking-tight">
            {t('auth.name.title', "What's your name?")}
          </Text>
          <Text className="text-md text-ink-muted">
            {t('auth.name.subtitle', 'This is how people will know you on Chathouse.')}
          </Text>
        </View>

        <View className="gap-xl">
          <Input
            label={t('auth.name.firstNameLabel', 'First name')}
            placeholder={t('auth.name.firstNamePlaceholder', 'Jane')}
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            maxLength={NAME_MAX}
            size="lg"
          />
          <Input
            label={t('auth.name.lastNameLabel', 'Last name')}
            placeholder={t('auth.name.lastNamePlaceholder', 'Doe')}
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={NAME_MAX}
            size="lg"
          />
        </View>

        <View className="flex-1" />

        <Button
          label={t('auth.name.submit', 'Next')}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canContinue}
          onPress={handleNext}
        />
      </View>
    </KeyboardAvoidingView>
  );
};
