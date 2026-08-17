import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { impactLight, notifySuccess } from '../../../../shared/utils/haptics';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { colors, spacing } from '../../../../shared/constants/theme';
import { mediaService } from '../../../../shared/services/api/mediaService';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import type { OnboardingStackParamList } from '../../../../core/navigation/types';
import { setupProfileFormSchema, type SetupProfileFormValues } from '../../schemas';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useTwitterImport } from '../../../extensions/hooks/useTwitterImport';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Onboarding'>;

const BIO_MAX = 150;

export const SetupProfileScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const setProfile = useOnboardingStore(s => s.setProfile);
  const { t } = useTranslation();
  // `avatarUri` is the local preview; `avatarBase64`/`avatarMime` feed the
  // upload that swaps it for a remote https URL before onboarding completes.
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMime, setAvatarMime] = useState<string | undefined>(undefined);
  // Remote avatar URL imported from X — used as-is at submit (no re-upload)
  // when the user hasn't picked a local photo on top of it.
  const [remoteAvatarUrl, setRemoteAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Remembers the last successfully-uploaded base64 → URL pair so a second
  // submit (e.g. after coming back to this screen) doesn't re-upload the
  // exact same image.
  const lastUploadRef = useRef<{ base64: string; url: string } | null>(null);
  const twitter = useTwitterImport();

  const pickImage = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        includeBase64: true,
        quality: 0.8,
        maxWidth: 1024,
        maxHeight: 1024,
        selectionLimit: 1,
      });
      if (result.didCancel) return;
      if (result.errorCode) {
        if (result.errorCode === 'permission') {
          Alert.alert(
            t('common.permissionDenied', 'Permission required'),
            t('onboarding.setupProfile.photoPermission', 'Allow photo access to choose a picture.'),
            [
              { text: t('common.cancel', 'Cancel'), style: 'cancel' },
              {
                text: t('onboarding.setupProfile.openSettings', 'Open settings'),
                onPress: () => {
                  void Linking.openSettings();
                },
              },
            ],
          );
        } else {
          Alert.alert(t('common.error', 'Something went wrong'));
        }
        return;
      }
      const asset = result.assets?.[0];
      if (asset?.uri) {
        setAvatarUri(asset.uri);
        setAvatarBase64(asset.base64 ?? null);
        setAvatarMime(asset.type);
        impactLight();
      }
    } catch {
      Alert.alert(t('common.error', 'Something went wrong'));
    }
  };

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SetupProfileFormValues>({
    resolver: zodResolver(setupProfileFormSchema),
    mode: 'onChange',
    defaultValues: { displayName: '', bio: '' },
  });

  const onImportFromX = useCallback(async () => {
    try {
      const profile = await twitter.start();
      if (!profile) return; // cancelled / denied / timed out
      if (profile.name) {
        setValue('displayName', profile.name.slice(0, 60), { shouldValidate: true });
      }
      if (profile.bio) {
        setValue('bio', profile.bio.slice(0, BIO_MAX), { shouldValidate: true });
      }
      if (profile.avatarUrl) {
        setAvatarUri(profile.avatarUrl);
        setRemoteAvatarUrl(profile.avatarUrl);
        // Drop any prior local pick so submit uses the imported remote URL.
        setAvatarBase64(null);
        setAvatarMime(undefined);
      }
      notifySuccess();
    } catch (err) {
      Alert.alert(
        t('common.error', 'Something went wrong'),
        errorMessage(err, t('onboarding.setupProfile.importFailed', "Couldn't import from X")),
      );
    }
  }, [twitter, setValue, t]);

  const onSubmit = useCallback(
    async (values: SetupProfileFormValues) => {
      try {
        // A locally-picked image is a file:// URI the backend can't read.
        // Upload its base64 first and store the REMOTE https URL so the later
        // completeOnboarding() flush (SuggestedFollows step) sends a usable
        // avatarUrl. With no pick, leave it null/undefined.
        let avatarUrl: string | null = null;
        if (avatarBase64) {
          if (lastUploadRef.current?.base64 === avatarBase64) {
            // Same image already uploaded on a previous submit — reuse its URL.
            avatarUrl = lastUploadRef.current.url;
          } else {
            setUploading(true);
            avatarUrl = await mediaService.uploadAvatar(avatarBase64, avatarMime);
            lastUploadRef.current = { base64: avatarBase64, url: avatarUrl };
          }
        } else if (remoteAvatarUrl) {
          // Imported from X — already a remote https URL, pass it through.
          avatarUrl = remoteAvatarUrl;
        }
        // Pass the (trimmed) values through as-is: '' is an explicit "clear"
        // the store understands, so a name typed on a first pass can be
        // erased on a later one instead of silently sticking around.
        setProfile({
          displayName: values.displayName ?? '',
          bio: values.bio ?? '',
          avatarUrl,
        });
        notifySuccess();
        navigation.navigate('InterestSelection');
      } catch (err) {
        Alert.alert(
          t('common.error', 'Something went wrong'),
          errorMessage(err, t('common.error', 'Something went wrong')),
        );
      } finally {
        setUploading(false);
      }
    },
    [navigation, setProfile, avatarBase64, avatarMime, remoteAvatarUrl, t],
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
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          setupStyles.scrollContent,
          { paddingBottom: insets.bottom + spacing.huge },
        ]}
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
            accessibilityRole="imagebutton"
            accessibilityLabel={t('onboarding.setupProfile.addPhoto', 'Add a photo')}
            className="items-center justify-center bg-surface w-32 h-32 rounded-full overflow-hidden border border-outline"
          >
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={setupStyles.avatarImage}
                resizeMode="cover"
                onError={() => {
                  // Broken preview (revoked file / dead remote URL): drop the
                  // avatar state so submit doesn't push an unusable image.
                  setAvatarUri(null);
                  setAvatarBase64(null);
                  setAvatarMime(undefined);
                  setRemoteAvatarUrl(null);
                }}
              />
            ) : (
              <MaterialIcons name="camera-alt" size={40} color={colors.textMuted} />
            )}
          </Pressable>
          <Text className="mt-sm text-sm text-ink-muted">
            {t('onboarding.setupProfile.addPhoto', 'Add a photo')}
          </Text>

          {twitter.configured ? (
            <Pressable
              onPress={onImportFromX}
              disabled={twitter.importing}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.setupProfile.importFromX', 'Import from X')}
              className="mt-md flex-row items-center gap-sm px-lg py-sm rounded-pill bg-surface border border-outline"
              style={twitter.importing ? setupStyles.importingBtn : undefined}
            >
              <MaterialIcons name="alternate-email" size={16} color={colors.text} />
              <Text className="text-sm font-body-bold text-ink">
                {twitter.importing
                  ? t('onboarding.setupProfile.importing', 'Importing…')
                  : t('onboarding.setupProfile.importFromX', 'Import from X')}
              </Text>
            </Pressable>
          ) : null}
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
            loading={isSubmitting || uploading}
            disabled={isSubmitting || uploading}
            onPress={handleSubmit(onSubmit)}
          />
          <Pressable onPress={onSkip} accessibilityRole="button" className="items-center py-sm">
            <Text className="text-md text-ink-muted">{t('onboarding.setupProfile.skip')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const setupStyles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xxl,
    gap: spacing.xxl,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  importingBtn: {
    opacity: 0.6,
  },
});
