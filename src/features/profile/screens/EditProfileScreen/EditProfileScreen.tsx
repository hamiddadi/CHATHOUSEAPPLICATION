import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { impactLight, notifySuccess } from '../../../../shared/utils/haptics';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import { mediaService } from '../../../../shared/services/api/mediaService';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { usernameFormSchema } from '../../../auth/schemas';
import { useMe, useUpdateProfile } from '../../hooks/useProfile';

const DISPLAY_NAME_MAX = 40;
const NAME_MAX = 50;
const BIO_MAX = 150;
const AVATAR_SIZE = 100;

export const EditProfileScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { data: me, isLoading } = useMe();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
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
    }
  }, [me]);

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    const asset = result.canceled ? undefined : result.assets[0];
    if (asset) {
      setAvatarUri(asset.uri);
      setAvatarBase64(asset.base64 ?? null);
      setAvatarMime(asset.mimeType);
      impactLight();
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
      await updateProfile.mutateAsync({
        displayName,
        firstName,
        lastName,
        username,
        bio,
        avatarUrl,
      });
      notifySuccess();
      navigation.goBack();
    } catch (err) {
      Alert.alert(
        t('profile.edit.error', 'Error'),
        errorMessage(
          err,
          t('profile.edit.failedToUpdate', 'Failed to update profile. Please try again.'),
        ),
      );
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
    navigation,
    updateProfile,
    username,
    t,
  ]);

  // Validate the username against the same schema the auth flow uses
  // (3–24 chars, [a-z0-9_]) instead of the laxer `length >= 2` check, so
  // an invalid handle (spaces, symbols, too short) can't reach update().
  const usernameOk = usernameFormSchema.shape.username.safeParse(username).success;
  // `busy` covers both the avatar upload and the profile PATCH so the button
  // shows a spinner and stays disabled across the whole save flow.
  const busy = uploading || updateProfile.isPending;
  const canSave = displayName.trim().length >= 2 && usernameOk && !busy;

  if (isLoading || !me) {
    return <Loader fullscreen accessibilityLabel={t('profile.edit.loading', 'Loading profile')} />;
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
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
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
