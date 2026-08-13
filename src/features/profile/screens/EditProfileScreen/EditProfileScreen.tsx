import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { launchImageLibrary } from 'react-native-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { impactLight, notifySuccess } from '../../../../shared/utils/haptics';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import { mediaService } from '../../../../shared/services/api/mediaService';
import { isAppError } from '../../../../shared/services/api/errorHandler';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { usernameFormSchema } from '../../../auth/schemas';
import { useMe, useUpdateProfile } from '../../hooks/useProfile';
import type { DmPrivacy } from '../../../../shared/types/domain';

const DM_PRIVACY_LABELS: Record<DmPrivacy, string> = {
  everyone: 'Tout le monde',
  followers: 'Mes abonnés',
  mutual: 'Amis (abonnement mutuel)',
  nobody: 'Personne',
};

const DISPLAY_NAME_MAX = 40;
const NAME_MAX = 50;
const BIO_MAX = 150;
const HANDLE_MAX = 50;
const AVATAR_SIZE = 100;

export const EditProfileScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { data: me, isLoading, isError, refetch } = useMe();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  // Server-side rejection of the handle (409 USER_002 "already taken") —
  // surfaced inline under the username Input. Cleared as soon as the user
  // edits the field again.
  const [usernameServerError, setUsernameServerError] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [twitter, setTwitter] = useState('');
  const [instagram, setInstagram] = useState('');
  const [dmPrivacy, setDmPrivacy] = useState<DmPrivacy>('mutual');
  // `avatarUri` is the local preview (file://). `avatarBase64`/`avatarMime`
  // hold the freshly-picked image so we can upload it on save and swap the
  // local URI for the remote https URL the backend returns.
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMime, setAvatarMime] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (me) {
      setDisplayName(me.displayName);
      setFirstName(me.firstName ?? '');
      setLastName(me.lastName ?? '');
      setUsername(me.username);
      setBio(me.bio ?? '');
      setTwitter(me.twitter ?? '');
      setInstagram(me.instagram ?? '');
      setDmPrivacy(me.dmPrivacy ?? 'mutual');
    }
  }, [me]);

  const handleDmPrivacy = useCallback(() => {
    Alert.alert(t('profile.edit.dmPrivacy', "Qui peut m'écrire ?"), undefined, [
      ...(['everyone', 'followers', 'mutual', 'nobody'] as DmPrivacy[]).map(v => ({
        text: DM_PRIVACY_LABELS[v],
        onPress: () => setDmPrivacy(v),
      })),
      { text: t('common.cancel', 'Annuler'), style: 'cancel' as const },
    ]);
  }, [t]);

  const handlePickImage = async () => {
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
      // Surface picker failures instead of silently doing nothing — a denied
      // photo permission gets a deep link to the app settings (mirrors
      // SetupProfileScreen's handling).
      if (result.errorCode) {
        if (result.errorCode === 'permission') {
          Alert.alert(
            t('common.permissionDenied', 'Permission required'),
            t('profile.edit.photoPermission', 'Allow photo access to choose a picture.'),
            [
              { text: t('common.cancel', 'Cancel'), style: 'cancel' },
              {
                text: t('profile.edit.openSettings', 'Open settings'),
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

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const handleSave = useCallback(async () => {
    try {
      // A freshly-picked image is a local file:// URI + base64; upload it
      // first and forward the REMOTE https URL (profileService.update only
      // accepts an http(s) URL). With no new pick, leave avatarUrl undefined
      // so the existing avatar is preserved.
      let avatarUrl: string | undefined;
      if (avatarBase64) {
        setUploading(true);
        avatarUrl = await mediaService.uploadAvatar(avatarBase64, avatarMime);
      }
      // Only send the username when it actually changed: the service PATCHes
      // it FIRST on a dedicated endpoint (all-or-nothing on the common
      // "already taken" failure), and re-submitting the unchanged handle
      // would be a pointless extra request.
      const nextUsername = username.trim();
      await updateProfile.mutateAsync({
        displayName,
        firstName,
        lastName,
        username: me && nextUsername !== me.username ? nextUsername : undefined,
        bio,
        avatarUrl,
        twitter,
        instagram,
        dmPrivacy,
      });
      notifySuccess();
      navigation.goBack();
    } catch (err) {
      // 409 USER_002 = handle already taken. The service sends the username
      // first, so nothing else was saved — tell the user exactly what to fix
      // (inline + alert) instead of the generic "failed to update".
      if (isAppError(err) && (err.code === 'USER_002' || err.kind === 'conflict')) {
        const taken = t('profile.edit.usernameTaken', 'This username is already taken.');
        setUsernameServerError(taken);
        Alert.alert(t('profile.edit.error', 'Error'), taken);
      } else {
        Alert.alert(
          t('profile.edit.error', 'Error'),
          errorMessage(
            err,
            t('profile.edit.failedToUpdate', 'Failed to update profile. Please try again.'),
          ),
        );
      }
      // Re-sync `me` regardless of the failure point: a partial save (e.g.
      // username PATCHed, profile PATCH failed) must not leave a stale cache.
      void refetch();
    } finally {
      setUploading(false);
    }
  }, [
    avatarBase64,
    avatarMime,
    bio,
    displayName,
    firstName,
    lastName,
    me,
    refetch,
    twitter,
    instagram,
    dmPrivacy,
    navigation,
    updateProfile,
    username,
    t,
  ]);

  // Validate the username against the same schema the auth flow uses
  // (3–24 chars, [a-z0-9_]) instead of the laxer `length >= 2` check, so
  // an invalid handle (spaces, symbols, too short) can't reach update().
  // Zod issue messages are i18n keys (auth.username.errors.*), rendered
  // inline via the Input's `error` prop so a greyed-out Save explains itself.
  const usernameParse = usernameFormSchema.shape.username.safeParse(username);
  const usernameOk = usernameParse.success;
  const usernameZodError = !usernameParse.success
    ? t(usernameParse.error.issues[0]?.message ?? 'auth.username.errors.format')
    : undefined;
  const usernameError = usernameServerError ?? usernameZodError;

  const handleUsernameChange = useCallback((next: string) => {
    setUsernameServerError(null);
    setUsername(next);
  }, []);
  // `busy` covers both the avatar upload and the profile PATCH so the button
  // shows a spinner and stays disabled across the whole save flow.
  const busy = uploading || updateProfile.isPending;
  const canSave = displayName.trim().length >= 2 && usernameOk && !busy;

  if (isLoading) {
    return <Loader fullscreen accessibilityLabel={t('profile.edit.loading', 'Loading profile')} />;
  }

  if (isError || !me) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center px-xxl py-lg">
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={t('profile.edit.cancelA11y', 'Cancel')}
            hitSlop={10}
          >
            <MaterialIcons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <EmptyState
          title={t('profile.edit.loadError', "Couldn't load your profile")}
          description={t('common.checkConnection', 'Check your connection and try again.')}
          actionLabel={t('common.retry', 'Retry')}
          onAction={() => void refetch()}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t('profile.edit.cancelA11y', 'Cancel')}
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">
          {t('profile.edit.title', 'Edit profile')}
        </Text>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={t('profile.edit.saveA11y', 'Save profile')}
          hitSlop={8}
          className={canSave ? '' : 'opacity-40'}
        >
          <Text className="text-md font-body-bold text-primary">
            {t('profile.edit.save', 'Save')}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-sm py-md">
          <View className="relative">
            <Avatar
              uri={avatarUri || me.avatarUrl || undefined}
              name={displayName}
              sizeValue={AVATAR_SIZE}
            />
            <Pressable
              onPress={handlePickImage}
              accessibilityRole="button"
              accessibilityLabel={t('profile.edit.changePhotoA11y', 'Change profile photo')}
              className="absolute -bottom-xxs -right-xxs w-10 h-10 rounded-pill bg-primary items-center justify-center border-2 border-background"
            >
              <MaterialIcons name="photo-camera" size={18} color={colors.onPrimary} />
            </Pressable>
          </View>
          <Text className="text-xs font-body text-ink-muted">
            {t('profile.edit.tapToChangePhoto', 'Tap to change photo')}
          </Text>
        </View>

        <View className="flex-row gap-md">
          <View className="flex-1">
            <Input
              label={t('profile.edit.firstName', 'First name')}
              value={firstName}
              onChangeText={setFirstName}
              maxLength={NAME_MAX}
              autoCapitalize="words"
            />
          </View>
          <View className="flex-1">
            <Input
              label={t('profile.edit.lastName', 'Last name')}
              value={lastName}
              onChangeText={setLastName}
              maxLength={NAME_MAX}
              autoCapitalize="words"
            />
          </View>
        </View>

        <Input
          label={t('profile.edit.displayName', 'Display name')}
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={DISPLAY_NAME_MAX}
          helperText={`${displayName.length} / ${DISPLAY_NAME_MAX}`}
        />

        <Input
          label={t('profile.edit.username', 'Username')}
          value={username}
          onChangeText={handleUsernameChange}
          autoCapitalize="none"
          autoCorrect={false}
          error={usernameError}
          leftAdornment={<Text className="text-md text-ink-muted">@</Text>}
        />

        <Input
          label={t('profile.edit.bio', 'Bio')}
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={4}
          maxLength={BIO_MAX}
          helperText={`${bio.length} / ${BIO_MAX}`}
        />

        <Input
          label={t('profile.edit.twitter', 'Twitter / X handle')}
          value={twitter}
          onChangeText={setTwitter}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={HANDLE_MAX}
          leftAdornment={<Text className="text-md text-ink-muted">@</Text>}
        />

        <Input
          label={t('profile.edit.instagram', 'Instagram handle')}
          value={instagram}
          onChangeText={setInstagram}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={HANDLE_MAX}
          leftAdornment={<Text className="text-md text-ink-muted">@</Text>}
        />

        <Pressable
          onPress={handleDmPrivacy}
          accessibilityRole="button"
          accessibilityLabel={t('profile.edit.dmPrivacy', "Qui peut m'écrire ?")}
          className="mt-md flex-row items-center justify-between p-md rounded-md bg-overlay-white-5"
        >
          <View className="flex-1">
            <Text className="text-xs font-body text-ink-muted">
              {t('profile.edit.dmPrivacy', "Qui peut m'écrire ?")}
            </Text>
            <Text className="text-md font-body-medium text-ink">
              {DM_PRIVACY_LABELS[dmPrivacy]}
            </Text>
          </View>
          <Text className="text-ink-muted text-base">›</Text>
        </Pressable>

        <View className="mt-xl">
          <Button
            label={t('profile.edit.saveChanges', 'Save changes')}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canSave}
            loading={busy}
            onPress={handleSave}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
