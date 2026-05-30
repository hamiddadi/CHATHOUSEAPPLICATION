import React, { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../../shared/components/Avatar';

interface ProfileIdentityProps {
  avatarUrl: string | null | undefined;
  displayName: string;
  username: string | null | undefined;
  isOnline: boolean;
  /** Full bio text (empty string when none). */
  bio: string;
  /** Pre-truncated bio honouring the expanded state. */
  displayBio: string;
  isBioLong: boolean;
  bioExpanded: boolean;
  onCopyUsername: () => void;
  onToggleBio: () => void;
}

const ProfileIdentity: React.FC<ProfileIdentityProps> = memo(
  ({
    avatarUrl,
    displayName,
    username,
    isOnline,
    bio,
    displayBio,
    isBioLong,
    bioExpanded,
    onCopyUsername,
    onToggleBio,
  }) => {
    const { t } = useTranslation();
    return (
      <>
        <Avatar
          uri={avatarUrl ?? undefined}
          name={displayName}
          sizeValue={120}
          status={isOnline ? 'online' : 'none'}
        />
        <View className="items-center gap-xxs">
          <Text className="text-xxxl font-display text-ink tracking-tight">{displayName}</Text>
          <Pressable
            onPress={onCopyUsername}
            accessibilityRole="button"
            className="active:opacity-60"
          >
            <Text className="text-sm font-body text-ink-muted">@{username}</Text>
          </Pressable>
        </View>

        {bio.length > 0 && (
          <View className="items-center gap-xs">
            <Text className="text-sm font-body text-ink text-center leading-normal">
              {displayBio}
            </Text>
            {isBioLong && (
              <Pressable onPress={onToggleBio}>
                <Text className="text-xs font-body-bold text-primary">
                  {bioExpanded ? t('profile.seeLess') : t('profile.seeMore')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </>
    );
  },
);
ProfileIdentity.displayName = 'ProfileIdentity';

export default ProfileIdentity;
