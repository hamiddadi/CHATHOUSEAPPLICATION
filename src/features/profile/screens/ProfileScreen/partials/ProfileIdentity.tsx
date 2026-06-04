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
  /** Real name parts (Clubhouse-style). When present, shown as the headline. */
  firstName?: string | null;
  lastName?: string | null;
  username: string | null | undefined;
  /** Account creation date (ISO) → rendered as "Joined {month year}". */
  joinedAt?: string | null;
  /** Username of the inviter → rendered as "Nominated by @inviter". */
  invitedByUsername?: string | null;
  isOnline: boolean;
  /** Full bio text (empty string when none). */
  bio: string;
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
    firstName,
    lastName,
    username,
    joinedAt,
    invitedByUsername,
    isOnline,
    bio,
    isBioLong,
    bioExpanded,
    twitter,
    instagram,
    onCopyUsername,
    onToggleBio,
  }) => {
    const { t } = useTranslation();
    const hasSocial = Boolean(twitter || instagram);
    // Real name takes the headline when set (Clubhouse identity); otherwise
    // fall back to the public displayName so the layout never goes blank.
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const headlineName = fullName || displayName;
    // "Joined March 2026" — month + year is enough and locale-aware. Guard a
    // malformed/absent date so we simply omit the line rather than crash.
    let joinedLabel: string | null = null;
    if (joinedAt) {
      const d = new Date(joinedAt);
      if (!Number.isNaN(d.getTime())) {
        joinedLabel = t('profile.joined', {
          date: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
          defaultValue: `Joined ${d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`,
        });
      }
    }
    return (
      <>
        <Avatar
          uri={avatarUrl ?? undefined}
          name={headlineName}
          sizeValue={120}
          status={isOnline ? 'online' : 'none'}
        />
        <View className="items-center gap-xxs">
          <Text className="text-xxxl font-display text-ink tracking-tight">{headlineName}</Text>
          <Pressable
            onPress={onCopyUsername}
            accessibilityRole="button"
            className="active:opacity-60"
          >
            <Text className="text-sm font-body text-ink-muted">@{username}</Text>
          </Pressable>
          {joinedLabel ? (
            <Text className="text-xs font-body text-ink-dim mt-xxs">{joinedLabel}</Text>
          ) : null}
          {invitedByUsername ? (
            <Text className="text-xs font-body text-ink-dim">
              {t('profile.nominatedBy', {
                handle: invitedByUsername,
                defaultValue: `Nominated by @${invitedByUsername}`,
              })}
            </Text>
          ) : null}
        </View>

        {bio.length > 0 && (
          <View className="items-center gap-xs">
            <Text
              className="text-sm font-body text-ink text-center leading-normal"
              numberOfLines={bioExpanded ? undefined : 3}
            >
              {bio}
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
