import React, { memo, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../shared/components/Avatar';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Input } from '../../../shared/components/Input';
import { Loader } from '../../../shared/components/Loader';
import { colors, spacing } from '../../../shared/constants/theme';
import { AdminHeader } from '../components/AdminHeader';
import { useAdminUsers } from '../hooks/useAdmin';
import type { AdminUser, AppRole } from '../types/admin.types';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';

type Nav = SettingsStackScreenProps<'AdminUsers'>['navigation'];

const SEARCH_DEBOUNCE_MS = 250;

const ROLES: readonly { id: AppRole | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'Tous' },
  { id: 'USER', label: 'User' },
  { id: 'MODERATOR', label: 'Mod' },
  { id: 'ADMIN', label: 'Admin' },
  { id: 'SUPER_ADMIN', label: 'Super' },
];

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
                <Text className="text-[9px] font-body-bold text-danger">SUSPENDU</Text>
              </View>
            ) : null}
            {user.deletedAt ? (
              <View style={styles.suspendedBadge}>
                <Text className="text-[9px] font-body-bold text-danger">SUPPRIMÉ</Text>
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
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [roleFilter, setRoleFilter] = useState<AppRole | 'ALL'>('ALL');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const params = useMemo(
    () => ({
      q: debounced.length > 0 ? debounced : undefined,
      role: roleFilter === 'ALL' ? undefined : (roleFilter as AppRole),
      limit: 50,
    }),
    [debounced, roleFilter],
  );
  const { data, isLoading, isError, refetch } = useAdminUsers(params);

  const handleOpen = (id: string) => navigation.navigate('AdminUserDetail', { userId: id });

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader title="Utilisateurs" />
      <View className="px-xxl gap-md">
        <Input
          placeholder="Rechercher par nom, email, téléphone…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.filterRow}>
          {ROLES.map(r => {
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
        <Loader fullscreen accessibilityLabel="Chargement…" />
      ) : isError || !data ? (
        <EmptyState title="Erreur de chargement" description="Réessayez plus tard." />
      ) : (
        <FlatList
          data={data.data}
          renderItem={({ item }) => <UserRow user={item} onPress={handleOpen} />}
          keyExtractor={u => u.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + spacing.giant,
          }}
          ListEmptyComponent={
            <EmptyState title="Aucun utilisateur" description="Aucun résultat avec ces filtres." />
          }
          onRefresh={refetch}
          refreshing={isLoading}
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
    borderRadius: 999,
    borderWidth: 1,
  },
  filterChipOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterChipOff: { borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'transparent' },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  suspendedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
});
