import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import { useMe, useUpdateProfile } from '../../hooks/useProfile';

const DISPLAY_NAME_MAX = 40;
const BIO_MAX = 160;
const AVATAR_SIZE = 100;

export const EditProfileScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { data: me, isLoading } = useMe();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');

  useEffect(() => {
    if (me) {
      setDisplayName(me.displayName);
      setUsername(me.username);
      setBio(me.bio ?? '');
    }
  }, [me]);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);
  const handleSave = useCallback(async () => {
    try {
      await updateProfile.mutateAsync({ displayName, username, bio });
      navigation.goBack();
    } catch {
      // Surface via toast later.
    }
  }, [bio, displayName, navigation, updateProfile, username]);

  const canSave =
    displayName.trim().length >= 2 && username.trim().length >= 2 && !updateProfile.isPending;

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
          className={canSave ? undefined : 'opacity-40'}
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
      >
        <View className="items-center gap-sm py-md">
          <View className="relative">
            <Avatar uri={me.avatarUrl ?? undefined} name={displayName} sizeValue={AVATAR_SIZE} />
            <Pressable
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

        <Button
          label="Save changes"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSave}
          loading={updateProfile.isPending}
          onPress={handleSave}
        />
      </ScrollView>
    </View>
  );
};
