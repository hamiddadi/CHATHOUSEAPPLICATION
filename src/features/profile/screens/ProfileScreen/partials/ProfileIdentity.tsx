import React, { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../../shared/components/Avatar';
import { colors } from '../../../../../shared/constants/theme';
import {
  openInstagramHandle,
  openTwitterHandle,
} from '../../../../extensions/utils/socialDeepLink';

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
  /** Twitter / X handle (helpers sanitise the leading '@'). */
  twitter?: string | null;
  /** Instagram handle (helpers sanitise the leading '@'). */
  instagram?: string | null;
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
    twitter,
    instagram,
    onCopyUsername,
    onToggleBio,
  }) => {
    const { t } = useTranslation();
    const hasSocial = Boolean(twitter || instagram);
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

        {hasSocial && (
          <View className="flex-row items-center justify-center gap-lg">
            {twitter ? (
              <Pressable
                onPress={() => void openTwitterHandle(twitter)}
                accessibilityRole="link"
                accessibilityLabel={`Twitter @${twitter.replace(/^@+/, '')}`}
                hitSlop={8}
                className="active:opacity-60"
              >
                <FontAwesome name="twitter" size={22} color={colors.textMuted} />
              </Pressable>
            ) : null}
            {instagram ? (
              <Pressable
                onPress={() => void openInstagramHandle(instagram)}
                accessibilityRole="link"
                accessibilityLabel={`Instagram @${instagram.replace(/^@+/, '')}`}
                hitSlop={8}
                className="active:opacity-60"
              >
                <FontAwesome name="instagram" size={22} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        )}
      </>
    );
  },
);
ProfileIdentity.displayName = 'ProfileIdentity';

export default ProfileIdentity;
