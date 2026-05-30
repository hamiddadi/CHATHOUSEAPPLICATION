import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { OnboardingStackParamList } from '../../../../core/navigation/types';
import { setupProfileFormSchema, type SetupProfileFormValues } from '../../schemas';
import { useOnboardingStore } from '../../store/onboardingStore';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Onboarding'>;

const BIO_MAX = 150;

export const SetupProfileScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const setProfile = useOnboardingStore(s => s.setProfile);
  const { t } = useTranslation();
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const pickImage = async () => {
    try {
      // Request media-library permission first; on some OSes launching the
      // picker without it rejects with an unhandled promise.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('common.permissionDenied', 'Permission required'),
          t('onboarding.setupProfile.photoPermission', 'Allow photo access to choose a picture.'),
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1], // For circular crop
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setAvatarUri(result.assets[0].uri);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      Alert.alert(t('common.error', 'Something went wrong'));
    }
  };

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetupProfileFormValues>({
    resolver: zodResolver(setupProfileFormSchema),
    mode: 'onChange',
    defaultValues: { displayName: '', bio: '' },
  });

  const onSubmit = useCallback(
    (values: SetupProfileFormValues) => {
      // TODO(audit): `avatarUri` is a local device URI (file://…). It must be
      // uploaded (multipart → /uploads or presigned S3) and the resulting
      // REMOTE url stored here before completeOnboarding sends it — a file://
      // URI is unusable by the backend. Requires a mediaService.uploadAvatar
      // helper + a backend upload endpoint (neither exists yet); wiring it is
      // an external dependency outside this screen.
      setProfile({
        displayName: values.displayName || undefined,
        bio: values.bio || undefined,
        avatarUrl: avatarUri,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.navigate('InterestSelection');
    },
    [navigation, setProfile, avatarUri],
  );

  const onSkip = useCallback(() => {
    navigation.navigate('InterestSelection');
  }, [navigation]);

  const displayNameError = errors.displayName?.message
    ? t(errors.displayName.message as string)
    : undefined;
  const bioError = errors.bio?.message ? t(errors.bio.message as string) : undefined;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top + spacing.xl }}
    >
      <View
        className="flex-1 px-xxl gap-xxl"
        style={{ paddingBottom: insets.bottom + spacing.huge }}
      >
        <View className="gap-md">
          <Text className="text-display font-display text-ink tracking-tight">
            {t('onboarding.setupProfile.title')}
          </Text>
          <Text className="text-md text-ink-muted">{t('onboarding.setupProfile.subtitle')}</Text>
        </View>

        <View className="items-center mb-md">
          <Pressable
            onPress={pickImage}
            className="items-center justify-center bg-surface w-32 h-32 rounded-full overflow-hidden border border-surface-border"
          >
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={setupStyles.avatarImage}
                contentFit="cover"
              />
            ) : (
              <MaterialIcons name="camera-alt" size={40} color={colors.textMuted} />
            )}
          </Pressable>
          <Text className="mt-sm text-sm text-ink-muted">
            {t('onboarding.setupProfile.addPhoto', 'Add a photo')}
          </Text>
        </View>

        <View className="gap-xl">
          <Controller
            control={control}
            name="displayName"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label={t('onboarding.setupProfile.displayNameLabel')}
                placeholder={t('onboarding.setupProfile.displayNamePlaceholder')}
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                maxLength={60}
                error={displayNameError}
                size="lg"
              />
            )}
          />

          <Controller
            control={control}
            name="bio"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label={t('onboarding.setupProfile.bioLabel')}
                placeholder={t('onboarding.setupProfile.bioPlaceholder')}
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                maxLength={BIO_MAX}
                multiline
                numberOfLines={4}
                error={bioError}
                helperText={`${(value ?? '').length} / ${BIO_MAX}`}
                size="lg"
              />
            )}
          />
        </View>

        <View className="flex-1" />

        <View className="gap-md">
          <Button
            label={t('onboarding.setupProfile.continue')}
            variant="primary"
            size="lg"
            fullWidth
            loading={isSubmitting}
            onPress={handleSubmit(onSubmit)}
          />
          <Pressable onPress={onSkip} accessibilityRole="button" className="items-center py-sm">
            <Text className="text-md text-ink-muted">{t('onboarding.setupProfile.skip')}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const setupStyles = StyleSheet.create({
  avatarImage: {
    width: '100%',
    height: '100%',
  },
});
