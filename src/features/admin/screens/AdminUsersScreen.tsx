import React, { memo, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Avatar } from '../../../shared/components/Avatar';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Input } from '../../../shared/components/Input';
import { Loader } from '../../../shared/components/Loader';
import { colors, radii, spacing, withAlpha } from '../../../shared/constants/theme';
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue';
import { AdminHeader } from '../components/AdminHeader';
import { useAdminUsersInfinite } from '../hooks/useAdmin';
import type { AdminUser, AppRole } from '../types/admin.types';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';

type Nav = SettingsStackScreenProps<'AdminUsers'>['navigation'];

const SEARCH_DEBOUNCE_MS = 250;

const getRoles = (t: TFunction): { id: AppRole | 'ALL'; label: string }[] => [
  { id: 'ALL', label: t('admin.users.roles.all') },
  { id: 'USER', label: t('admin.users.roles.user') },
  { id: 'MODERATOR', label: t('admin.users.roles.mod') },
  { id: 'ADMIN', label: t('admin.users.roles.admin') },
  { id: 'SUPER_ADMIN', label: t('admin.users.roles.super') },
];

// Role-identity accent palette. These are intentional, mutually-distinct
// literals — NOT theme surface tokens. In particular ADMIN must not be routed
// through colors.danger (#ffb4ab): that is the same hue the Suspended/Deleted
// badges use (text-danger), so an ADMIN who is also suspended would show two
// badges in identical color, destroying the visual distinction.
const roleColor = (role: AppRole): string =>
  role === 'SUPER_ADMIN'
    ? '#FFB300'
    : role === 'ADMIN'
      ? '#FF6F61'
      : role === 'MODERATOR'
        ? '#7BB1FF'
        : colors.textMuted;

const UserRow: React.FC<{ user: AdminUser; onPress: (id: string) => void }> = memo(
  ({ user, onPress }) => {
    const { t } = useTranslation();
    const isSuspended = user.suspendedUntil && new Date(user.suspendedUntil) > new Date();
    return (
      <Pressable
        onPress={() => onPress(user.id)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${user.displayName ?? user.username ?? 'user'}`}
        className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5"
      >
        <Avatar
          uri={user.avatarUrl ?? undefined}
          name={user.displayName ?? user.username ?? '?'}
          sizeValue={40}
          status={user.isOnline ? 'online' : 'offline'}
        />
        <View className="flex-1">
          <View className="flex-row items-center gap-xs">
            <Text className="text-sm font-body-bold text-white" numberOfLines={1}>
              {user.displayName || user.username || '—'}
            </Text>
            <Text className="text-xs text-ink-dim">@{user.username ?? '—'}</Text>
          </View>
          <View className="flex-row items-center gap-xs mt-xxs">
            <View style={[styles.roleBadge, { borderColor: roleColor(user.appRole) }]}>
              <Text
                className="text-[9px] font-body-bold"
                style={{ color: roleColor(user.appRole) }}
              >
                {user.appRole}
              </Text>
            </View>
            {isSuspended ? (
              <View style={styles.suspendedBadge}>
                <Text className="text-[9px] font-body-bold text-danger">
                  {t('admin.users.badgeSuspended')}
                </Text>
              </View>
            ) : null}
            {user.deletedAt ? (
              <View style={styles.suspendedBadge}>
                <Text className="text-[9px] font-body-bold text-danger">
                  {t('admin.users.badgeDeleted')}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  },
);
UserRow.displayName = 'UserRow';

export const AdminUsersScreen: React.FC<SettingsStackScreenProps<'AdminUsers'>> = ({
  navigation,
}: {
  navigation: Nav;
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<AppRole | 'ALL'>('ALL');

  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS).trim();

  const params = useMemo(
    () => ({
      q: debounced.length > 0 ? debounced : undefined,
      role: roleFilter === 'ALL' ? undefined : (roleFilter as AppRole),
      limit: 50,
    }),
    [debounced, roleFilter],
  );
  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAdminUsersInfinite(params);
  // Flatten the cursor pages into a single list for the FlatList.
  const users = useMemo(() => data?.pages.flatMap(p => p.data) ?? [], [data]);

  const handleOpen = (id: string) => navigation.navigate('AdminUserDetail', { userId: id });
  const handleEndReached = () => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader title={t('admin.users.title')} />
      <View className="px-xxl gap-md">
        <Input
          placeholder={t('admin.users.searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.filterRow}>
          {getRoles(t).map(r => {
            const selected = roleFilter === r.id;
            return (
              <Pressable
                key={r.id}
                onPress={() => setRoleFilter(r.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.filterChip, selected ? styles.filterChipOn : styles.filterChipOff]}
              >
                <Text
                  className={
                    selected
                      ? 'text-xs font-body-bold text-primary-on-container'
                      : 'text-xs font-body-bold text-ink-muted'
                  }
                >
                  {r.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading', 'Loading…')} />
      ) : isError || !data ? (
        <EmptyState title={t('admin.users.errorTitle')} description={t('admin.users.errorBody')} />
      ) : (
        <FlatList
          data={users}
          renderItem={({ item }) => <UserRow user={item} onPress={handleOpen} />}
          keyExtractor={u => u.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + spacing.giant,
          }}
          ListEmptyComponent={
            <EmptyState
              title={t('admin.users.emptyTitle')}
              description={t('admin.users.emptyBody')}
            />
          }
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ paddingVertical: spacing.lg }}>
                <Loader accessibilityLabel={t('common.loading', 'Loading…')} />
              </View>
            ) : null
          }
          onRefresh={refetch}
          refreshing={isRefetching}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  filterChipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterChipOff: { borderColor: colors.overlayWhite15, backgroundColor: 'transparent' },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.xs,
    borderWidth: 1,
  },
  suspendedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.xs,
    backgroundColor: withAlpha(colors.danger, 0.15),
  },
});
