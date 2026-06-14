import React, { memo, useCallback } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { UserSummary } from '../../../../shared/types/domain';
import { useBlockedUsers, useUnblock } from '../../../social/hooks/useSocial';

interface BlockedRowProps {
  user: UserSummary;
  onUnblock: (user: UserSummary) => void;
  pending: boolean;
}

const BlockedRow: React.FC<BlockedRowProps> = memo(({ user, onUnblock, pending }) => {
  const { t } = useTranslation();
  const handle = useCallback(() => onUnblock(user), [onUnblock, user]);
  return (
    <View className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5">
      <Avatar uri={user.avatarUrl ?? undefined} name={user.displayName} size="md" />
      <View className="flex-1">
        <Text className="text-md font-body-bold text-ink">{user.displayName}</Text>
        <Text className="text-xs font-body text-ink-muted">@{user.username}</Text>
      </View>
      <Button
        label={t('blockedUsers.unblock', 'Unblock')}
        variant="danger"
        size="sm"
        loading={pending}
        onPress={handle}
      />
    </View>
  );
});
BlockedRow.displayName = 'BlockedRow';

export const BlockedUsersScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError } = useBlockedUsers();
  const unblock = useUnblock();

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleUnblock = useCallback(
    (user: UserSummary) => {
      // Surface failures so the destructive action gives feedback on a network
      // error (mirrors FollowersScreen's toggle-error Alert). The mutation
      // invalidates the blocked-users query on success, so the row disappears.
      unblock.mutate(user.id, {
        onError: () =>
          Alert.alert(
            t('common.error', 'Something went wrong'),
            t('blockedUsers.unblockFailed', 'Could not unblock. Please try again.'),
          ),
      });
    },
    [unblock, t],
  );

  const pendingId = unblock.isPending ? unblock.variables : null;

  const renderItem = useCallback(
    ({ item }: { item: UserSummary }) => (
      <BlockedRow user={item} onUnblock={handleUnblock} pending={pendingId === item.id} />
    ),
    [handleUnblock, pendingId],
  );
  const keyExtractor = useCallback((item: UserSummary) => item.id, []);
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
          {t('blockedUsers.title', 'Blocked accounts')}
        </Text>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('blockedUsers.title', 'Blocked accounts')} />
      ) : isError ? (
        <EmptyState
          title={t('blockedUsers.loadError', "Couldn't load blocked accounts")}
          description={t('profile.pleaseTryAgain', 'Please try again.')}
        />
      ) : (
        <FlatList
          data={data ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.giant }]}
          ListEmptyComponent={
            <EmptyState
              title={t('blockedUsers.empty', 'No blocked accounts')}
              description={t(
                'blockedUsers.emptyHint',
                'People you block appear here. You can unblock them at any time.',
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
