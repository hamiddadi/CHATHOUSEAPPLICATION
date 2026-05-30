import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import { usernameFormSchema } from '../../../auth/schemas';
import { useMe, useUpdateProfile } from '../../hooks/useProfile';

const DISPLAY_NAME_MAX = 40;
const BIO_MAX = 150;
const AVATAR_SIZE = 100;

export const EditProfileScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { data: me, isLoading } = useMe();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useEffect(() => {
    if (me) {
      setDisplayName(me.displayName);
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
    });

    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const handleSave = useCallback(async () => {
    try {
      await updateProfile.mutateAsync({
        displayName,
        username,
        bio,
        avatarUrl: avatarUri || undefined,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    }
  }, [avatarUri, bio, displayName, navigation, updateProfile, username]);

  // Validate the username against the same schema the auth flow uses
  // (3–24 chars, [a-z0-9_]) instead of the laxer `length >= 2` check, so
  // an invalid handle (spaces, symbols, too short) can't reach update().
  const usernameOk = usernameFormSchema.shape.username.safeParse(username).success;
  const canSave = displayName.trim().length >= 2 && usernameOk && !updateProfile.isPending;

  if (isLoading || !me) {
    return <Loader fullscreen accessibilityLabel="Loading profile" />;
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">Edit profile</Text>
        <Pressable
          onPress={handleSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save profile"
          hitSlop={8}
          className={canSave ? '' : 'opacity-40'}
        >
          <Text className="text-md font-body-bold text-primary">Save</Text>
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
              accessibilityLabel="Change profile photo"
              className="absolute -bottom-xxs -right-xxs w-10 h-10 rounded-pill bg-primary items-center justify-center border-2 border-background"
            >
              <MaterialIcons name="photo-camera" size={18} color={colors.onPrimary} />
            </Pressable>
          </View>
          <Text className="text-xs font-body text-ink-muted">Tap to change photo</Text>
        </View>

        <Input
          label="Display name"
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={DISPLAY_NAME_MAX}
          helperText={`${displayName.length} / ${DISPLAY_NAME_MAX}`}
        />

        <Input
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          leftAdornment={<Text className="text-md text-ink-muted">@</Text>}
        />

        <Input
          label="Bio"
          value={bio}
          onChangeText={setBio}
          multiline
          numberOfLines={4}
          maxLength={BIO_MAX}
          helperText={`${bio.length} / ${BIO_MAX}`}
        />

        <View className="mt-xl">
          <Button
            label="Save changes"
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canSave}
            loading={updateProfile.isPending}
            onPress={handleSave}
          />
        </View>
      </ScrollView>
    </View>
  );
};
