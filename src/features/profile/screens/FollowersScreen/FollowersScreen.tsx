import React, { memo, useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { SettingsStackParamList } from '../../../../core/navigation/types';
import type { User } from '../../../../shared/types/domain';
import { useFollow, useFollowers, useFollowing, useUnfollow } from '../../hooks/useProfile';

type Route = RouteProp<SettingsStackParamList, 'Followers'>;
type Tab = 'followers' | 'following';

interface UserRowProps {
  user: User;
  onToggle: (user: User) => void;
  pending: boolean;
}

const UserRow: React.FC<UserRowProps> = memo(({ user, onToggle, pending }) => {
  const { t } = useTranslation();
  const handle = useCallback(() => onToggle(user), [onToggle, user]);
  return (
    <View className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5">
      <Avatar uri={user.avatarUrl ?? undefined} name={user.displayName} size="md" />
      <View className="flex-1">
        <Text className="text-md font-body-bold text-ink">{user.displayName}</Text>
        <Text className="text-xs font-body text-ink-muted">@{user.username}</Text>
      </View>
      <Button
        label={
          user.isFollowedByMe ? t('profile.following', 'Following') : t('profile.follow', 'Follow')
        }
        variant={user.isFollowedByMe ? 'ghost' : 'primary'}
        size="sm"
        loading={pending}
        onPress={handle}
      />
    </View>
  );
});
UserRow.displayName = 'UserRow';

interface TabToggleProps {
  value: Tab;
  onChange: (t: Tab) => void;
}

const TabToggle: React.FC<TabToggleProps> = memo(({ value, onChange }) => {
  const { t } = useTranslation();
  const setF = useCallback(() => onChange('followers'), [onChange]);
  const setG = useCallback(() => onChange('following'), [onChange]);
  return (
    <View className="flex-row bg-surface-high rounded-pill p-xxs">
      <Pressable
        onPress={setF}
        accessibilityRole="tab"
        accessibilityState={{ selected: value === 'followers' }}
        className={
          value === 'followers'
            ? 'flex-1 py-sm rounded-pill bg-primary items-center'
            : 'flex-1 py-sm items-center'
        }
      >
        <Text
          className={
            value === 'followers'
              ? 'text-sm font-body-bold text-primary-on-container'
              : 'text-sm font-body-bold text-ink-muted'
          }
        >
          {t('profile.followers', 'Followers')}
        </Text>
      </Pressable>
      <Pressable
        onPress={setG}
        accessibilityRole="tab"
        accessibilityState={{ selected: value === 'following' }}
        className={
          value === 'following'
            ? 'flex-1 py-sm rounded-pill bg-primary items-center'
            : 'flex-1 py-sm items-center'
        }
      >
        <Text
          className={
            value === 'following'
              ? 'text-sm font-body-bold text-primary-on-container'
              : 'text-sm font-body-bold text-ink-muted'
          }
        >
          {t('profile.following', 'Following')}
        </Text>
      </Pressable>
    </View>
  );
});
TabToggle.displayName = 'TabToggle';

export const FollowersScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>(route.params.initialTab ?? 'followers');

  const followersQuery = useFollowers(route.params.userId);
  const followingQuery = useFollowing(route.params.userId);
  const follow = useFollow();
  const unfollow = useUnfollow();

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleToggle = useCallback(
    (user: User) => {
      // Surface follow/unfollow failures — the hook re-syncs the cache on
      // error, but without this the button gives no feedback on a network
      // failure (mirrors ProfileScreen's toggle-error Alert).
      const onError = (): void =>
        Alert.alert(
          t('common.error', 'Something went wrong'),
          t('profile.actionFailed', 'Action failed. Please try again.'),
        );
      if (user.isFollowedByMe) unfollow.mutate(user.id, { onError });
      else follow.mutate(user.id, { onError });
    },
    [follow, t, unfollow],
  );

  const active = tab === 'followers' ? followersQuery : followingQuery;
  const pendingId = follow.isPending
    ? follow.variables
    : unfollow.isPending
      ? unfollow.variables
      : null;

  const renderItem = useCallback(
    ({ item }: { item: User }) => (
      <UserRow user={item} onToggle={handleToggle} pending={pendingId === item.id} />
    ),
    [handleToggle, pendingId],
  );
  const keyExtractor = useCallback((item: User) => item.id, []);
  const renderSeparator = useCallback(() => <View className="h-sm" />, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">
          {t('profile.connections', 'Connections')}
        </Text>
      </View>

      <View className="px-xxl mb-lg">
        <TabToggle value={tab} onChange={setTab} />
      </View>

      {active.isLoading ? (
        <Loader
          fullscreen
          accessibilityLabel={t('profile.loadingConnections', 'Loading connections')}
        />
      ) : active.isError ? (
        <EmptyState
          title={t('profile.couldNotLoadConnections', "Couldn't load list")}
          description={t('profile.pleaseTryAgain', 'Please try again.')}
        />
      ) : (
        <FlatList
          data={active.data ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.giant }]}
          ListEmptyComponent={
            <EmptyState
              title={
                tab === 'followers'
                  ? t('profile.noFollowers', 'No followers yet')
                  : t('profile.noFollowing', 'Not following anyone yet')
              }
              description={t(
                'profile.emptyConnectionsHint',
                'When there are people here, they show up in this list.',
              )}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.xxl },
});
