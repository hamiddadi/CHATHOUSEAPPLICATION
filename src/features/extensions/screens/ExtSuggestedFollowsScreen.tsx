import React, { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useExtSuggestions } from '../hooks/useSuggestions';
import type { SuggestedUser } from '../api/suggestionsApi';
import { colors } from '../../../shared/constants/theme';

interface Props {
  onTapUser?: (user: SuggestedUser) => void;
  onFollow?: (user: SuggestedUser) => Promise<void> | void;
}

interface UserRowProps {
  item: SuggestedUser;
  isFollowed: boolean;
  onTap?: (user: SuggestedUser) => void;
  onFollow: (user: SuggestedUser) => void;
  t: TFunction;
}

const reasonLabel = (u: SuggestedUser, t: TFunction): string => {
  if (u.reason === 'shared_interests' && u.sharedInterestsCount > 0) {
    return t('extensions.suggested.sharedInterests', '{{count}} shared interest(s)', {
      count: u.sharedInterestsCount,
    });
  }
  if (u.reason === 'friends_of_friends')
    return t('extensions.suggested.friendsOfFriends', 'Followed by people you follow');
  // `count` is interpolated as a pre-formatted string (toLocaleString) to keep
  // the grouped display; cast satisfies i18next's numeric `count` option type
  // without changing the rendered text.
  return t('extensions.suggested.followersCount', '{{count}} followers', {
    count: u.followerCount.toLocaleString() as unknown as number,
  });
};

const UserRow: React.FC<UserRowProps> = memo(({ item, isFollowed, onTap, onFollow, t }) => {
  const handleTap = useCallback(() => onTap?.(item), [onTap, item]);
  const handleFollowPress = useCallback(() => onFollow(item), [onFollow, item]);

  return (
    <Pressable
      style={styles.row}
      onPress={handleTap}
      accessibilityRole="button"
      accessibilityLabel={t('extensions.suggested.viewProfile', 'View profile of {{name}}', {
        name: item.displayName ?? item.username,
      })}
    >
      {item.avatarUrl ? (
        <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarFallbackText}>
            {(item.displayName ?? item.username ?? '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {item.displayName ?? item.username}
        </Text>
        {item.bio ? (
          <Text style={styles.bio} numberOfLines={2}>
            {item.bio}
          </Text>
        ) : null}
        <Text style={styles.reason}>{reasonLabel(item, t)}</Text>
      </View>
      <Pressable
        style={[styles.followBtn, isFollowed && styles.followBtnDone]}
        onPress={handleFollowPress}
        disabled={isFollowed}
        accessibilityRole="button"
        accessibilityState={{ selected: isFollowed, disabled: isFollowed }}
        accessibilityLabel={t('extensions.suggested.followUserA11y', 'Follow {{name}}', {
          name: item.displayName ?? item.username,
        })}
      >
        <Text style={[styles.followBtnText, isFollowed && styles.followBtnTextDone]}>
          {isFollowed
            ? t('extensions.suggested.following', 'Following')
            : t('extensions.suggested.follow', 'Follow')}
        </Text>
      </Pressable>
    </Pressable>
  );
});
UserRow.displayName = 'UserRow';

/**
 * "People you may want to follow" screen — typically presented right after
 * interest selection (Module 1.5). Reachable via deep-link
 * `chathouse://r/ext/suggested-follows` so the existing navigator stays
 * untouched.
 */
export const ExtSuggestedFollowsScreen: React.FC<Props> = memo(({ onTapUser, onFollow }) => {
  const { t } = useTranslation();
  const { data, isLoading, refetch, isRefetching } = useExtSuggestions(30);
  // Track who we've already followed so a second tap can't fire a duplicate
  // follow and the button reflects the new state.
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  const handleFollow = useCallback(
    (user: SuggestedUser) => {
      if (followed.has(user.id)) return;
      setFollowed(prev => new Set(prev).add(user.id));
      void Promise.resolve(onFollow?.(user)).catch(() => {
        // Roll back on failure so the user can retry.
        setFollowed(prev => {
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
      });
    },
    [followed, onFollow],
  );

  const renderItem = useCallback(
    ({ item }: { item: SuggestedUser }) => (
      <UserRow
        item={item}
        isFollowed={followed.has(item.id)}
        onTap={onTapUser}
        onFollow={handleFollow}
        t={t}
      />
    ),
    [followed, onTapUser, handleFollow, t],
  );

  const keyExtractor = useCallback((u: SuggestedUser) => u.id, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('extensions.suggested.title', 'People you may know')}</Text>
        <Text style={styles.subtitle}>
          {t('extensions.suggested.subtitle', 'Based on your interests and people you follow.')}
        </Text>
      </View>
      {isLoading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={keyExtractor}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {t('extensions.suggested.empty', 'No suggestions yet. Come back later.')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
});
ExtSuggestedFollowsScreen.displayName = 'ExtSuggestedFollowsScreen';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: {
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: { color: colors.textMuted, fontWeight: '600', fontSize: 20 },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  bio: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  reason: { fontSize: 11, color: colors.primary, marginTop: 4 },
  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  followBtnDone: {
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnText: { color: colors.onPrimary, fontWeight: '600', fontSize: 13 },
  followBtnTextDone: { color: colors.textMuted },
  empty: { marginTop: 48, alignItems: 'center' },
  emptyText: { color: colors.textMuted },
  loader: { marginTop: 32 },
});
