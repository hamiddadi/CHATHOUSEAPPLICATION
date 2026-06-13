import React, { useCallback } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Avatar } from '../../../shared/components/Avatar';
import { Button } from '../../../shared/components/Button';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Loader } from '../../../shared/components/Loader';
import { colors, radii, spacing, withAlpha } from '../../../shared/constants/theme';
import { errorMessage } from '../../../shared/utils/errorMessage';
import { AdminHeader } from '../components/AdminHeader';
import {
  useAdminUser,
  useAdminWhoami,
  useDeleteUser,
  useSetUserRole,
  useSuspendUser,
  useUnsuspendUser,
} from '../hooks/useAdmin';
import { promptForReason } from '../promptForReason';
import { useImpersonationStore } from '../store/impersonationStore';
import { isAtLeast, ROLE_RANK, type AppRole } from '../types/admin.types';
import { formatDate, formatDateTime } from '../../../shared/utils/intl';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';

const ASSIGNABLE_ROLES: AppRole[] = ['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

const getSuspendPresets = (t: TFunction): { id: string; label: string; minutes?: number }[] => [
  { id: '1h', label: t('admin.userDetail.suspend1h'), minutes: 60 },
  { id: '24h', label: t('admin.userDetail.suspend24h'), minutes: 60 * 24 },
  { id: '7d', label: t('admin.userDetail.suspend7d'), minutes: 60 * 24 * 7 },
  { id: 'perm', label: t('admin.userDetail.suspendPerm') },
];

export const AdminUserDetailScreen: React.FC<SettingsStackScreenProps<'AdminUserDetail'>> = ({
  route,
  navigation,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { userId } = route.params;
  const { data: me } = useAdminWhoami();
  const { data: user, isLoading, isError } = useAdminUser(userId);
  const setRole = useSetUserRole();
  const suspend = useSuspendUser();
  const unsuspend = useUnsuspendUser();
  const del = useDeleteUser();
  const startImpersonation = useImpersonationStore(s => s.start);

  // Suspension reason: collected via Alert.prompt on iOS, falls back to a
  // generic motif on Android. Custom modal will replace this in v2.

  const myRole = me?.appRole ?? 'USER';
  const isSuper = isAtLeast(myRole, 'SUPER_ADMIN');
  const targetRole = user?.appRole ?? 'USER';
  // You can act on a user only if your rank is strictly higher than theirs.
  const canActOnTarget = ROLE_RANK[myRole] > ROLE_RANK[targetRole];
  const isSuspended = user?.suspendedUntil ? new Date(user.suspendedUntil) > new Date() : false;

  const handleSetRole = useCallback(
    (role: AppRole) => {
      if (!user) return;
      Alert.alert(
        t('admin.userDetail.roleTitle'),
        `${t('admin.userDetail.roleDesc')} @${user.username ?? user.id} → ${role} ?`,
        [
          { text: t('admin.userDetail.cancel'), style: 'cancel' },
          {
            text: t('admin.userDetail.confirm'),
            style: 'destructive',
            onPress: () =>
              setRole.mutate(
                { userId: user.id, role },
                {
                  onError: e =>
                    Alert.alert(
                      t('common.error', 'Error'),
                      errorMessage(e, t('common.actionFailed', 'Failed')),
                    ),
                },
              ),
          },
        ],
      );
    },
    [setRole, user, t],
  );

  const handleSuspend = useCallback(
    (minutes: number | undefined) => {
      if (!user) return;
      const fire = (motif: string): void => {
        suspend.mutate(
          { userId: user.id, reason: motif, durationMinutes: minutes },
          {
            onError: e =>
              Alert.alert(
                t('common.error', 'Error'),
                errorMessage(e, t('common.actionFailed', 'Failed')),
              ),
          },
        );
      };
      promptForReason(
        {
          title: t('admin.userDetail.suspendTitle'),
          message: t('admin.userDetail.suspendReason'),
          confirmLabel: t('admin.userDetail.suspendBtn'),
          defaultReason: 'Moderation',
        },
        fire,
      );
    },
    [suspend, user, t],
  );

  const handleUnsuspend = useCallback(() => {
    if (!user) return;
    Alert.alert(
      t('admin.userDetail.unsuspendTitle'),
      `${t('admin.userDetail.unsuspendDesc')} @${user.username ?? user.id} ?`,
      [
        { text: t('admin.userDetail.cancel'), style: 'cancel' },
        {
          text: t('admin.userDetail.confirm'),
          onPress: () =>
            unsuspend.mutate(user.id, {
              onError: e =>
                Alert.alert(
                  t('common.error', 'Error'),
                  errorMessage(e, t('common.actionFailed', 'Failed')),
                ),
            }),
        },
      ],
    );
  }, [unsuspend, user, t]);

  const handleImpersonate = useCallback(() => {
    if (!user) return;
    Alert.alert(
      t('admin.userDetail.impersonateTitle'),
      `${t('admin.userDetail.impersonateDesc')} @${user.username ?? user.id} ?\n\n${t('admin.userDetail.impersonateWarn')}`,
      [
        { text: t('admin.userDetail.cancel'), style: 'cancel' },
        {
          text: t('admin.userDetail.impersonateBtn'),
          style: 'destructive',
          onPress: async () => {
            try {
              await startImpersonation(user.id);
              navigation.popToTop();
            } catch (e) {
              Alert.alert(
                t('common.error', 'Error'),
                errorMessage(e, t('common.actionFailed', 'Failed')),
              );
            }
          },
        },
      ],
    );
  }, [navigation, startImpersonation, user, t]);

  const handleDelete = useCallback(() => {
    if (!user) return;
    Alert.alert(
      t('admin.userDetail.deleteTitle'),
      `${t('admin.userDetail.deleteDesc')} @${user.username ?? user.id} ?`,
      [
        { text: t('admin.userDetail.cancel'), style: 'cancel' },
        {
          text: t('admin.userDetail.deleteBtn'),
          style: 'destructive',
          onPress: () =>
            del.mutate(user.id, {
              onSuccess: () => navigation.goBack(),
              onError: e =>
                Alert.alert(
                  t('common.error', 'Error'),
                  errorMessage(e, t('common.actionFailed', 'Failed')),
                ),
            }),
        },
      ],
    );
  }, [del, navigation, user, t]);

  if (isLoading) return <Loader fullscreen accessibilityLabel={t('common.loading', 'Loading…')} />;
  if (isError || !user) {
    return <EmptyState title={t('admin.userDetail.notFound')} description="" />;
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader
        title={user.displayName ?? user.username ?? t('admin.userDetail.user')}
        subtitle={`@${user.username ?? user.id} · ${user.appRole}`}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.lg,
        }}
      >
        <View className="items-center gap-sm">
          <Avatar
            uri={user.avatarUrl ?? undefined}
            name={user.displayName ?? user.username ?? '?'}
            sizeValue={88}
            status={user.isOnline ? 'online' : 'offline'}
          />
          <Text className="text-2xl font-display text-white">
            {user.displayName ?? user.username ?? '—'}
          </Text>
          <Text className="text-sm text-ink-muted">@{user.username ?? '—'}</Text>
          <View style={styles.roleHero}>
            <Text className="text-xs font-body-bold uppercase tracking-widest text-primary">
              {user.appRole}
            </Text>
          </View>
          {isSuspended ? (
            <View style={styles.suspendedHero}>
              <MaterialIcons name="lock" size={14} color={colors.danger} />
              <Text className="text-xs font-body-bold text-danger">
                {t('admin.userDetail.suspendedUntil')} {formatDateTime(user.suspendedUntil)}
              </Text>
            </View>
          ) : null}
          {user.suspensionReason ? (
            <Text className="text-xs text-ink-dim text-center">
              {t('admin.userDetail.reason')} : {user.suspensionReason}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('admin.userDetail.infoTitle')}</Text>
          <Field label={t('admin.userDetail.email')} value={user.email ?? '—'} />
          <Field label={t('admin.userDetail.phone')} value={user.phoneNumber ?? '—'} />
          <Field label={t('admin.userDetail.joined')} value={formatDate(user.createdAt)} />
          <Field label={t('admin.userDetail.lastSeen')} value={formatDateTime(user.lastSeenAt)} />
          <Field
            label={t('admin.userDetail.followers')}
            value={`${user.followerCount} / ${user.followingCount}`}
          />
        </View>

        {!canActOnTarget ? (
          <View style={styles.note}>
            <Text className="text-xs text-ink-dim">{t('admin.userDetail.noActionPerm')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('admin.userDetail.suspendSection')}</Text>
              {isSuspended ? (
                <Button
                  label={t('admin.userDetail.unsuspendBtn')}
                  variant="primaryContainer"
                  fullWidth
                  loading={unsuspend.isPending}
                  onPress={handleUnsuspend}
                />
              ) : (
                <View style={styles.presetGrid}>
                  {getSuspendPresets(t).map(p => (
                    <Pressable
                      key={p.id}
                      onPress={() => handleSuspend(p.minutes)}
                      style={styles.presetBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Suspendre ${p.label}`}
                    >
                      <Text className="text-xs font-body-bold text-warning">{p.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {isSuper ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('admin.userDetail.roleSection')}</Text>
                <View style={styles.presetGrid}>
                  {ASSIGNABLE_ROLES.map(r => {
                    const selected = user.appRole === r;
                    return (
                      <Pressable
                        key={r}
                        onPress={() => handleSetRole(r)}
                        disabled={selected}
                        style={[styles.presetBtn, selected ? styles.presetBtnSelected : null]}
                        accessibilityRole="button"
                        accessibilityLabel={`Définir le rôle ${r}`}
                        accessibilityState={{ selected, disabled: selected }}
                      >
                        <Text
                          className={
                            selected
                              ? 'text-xs font-body-bold text-primary'
                              : 'text-xs font-body-bold text-white'
                          }
                        >
                          {r}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {isSuper && !user.deletedAt ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    {t('admin.userDetail.investigationSection')}
                  </Text>
                  <Button
                    label={t('admin.userDetail.impersonateBtn')}
                    variant="primaryContainer"
                    fullWidth
                    onPress={handleImpersonate}
                  />
                  <Text className="text-xs text-ink-dim">
                    {t('admin.userDetail.impersonateInfo')}
                  </Text>
                </View>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>{t('admin.userDetail.dangerSection')}</Text>
                  <Button
                    label={t('admin.userDetail.deleteBtn')}
                    variant="danger"
                    fullWidth
                    loading={del.isPending}
                    onPress={handleDelete}
                  />
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View className="flex-row justify-between py-xs">
    <Text className="text-xs text-ink-muted">{label}</Text>
    <Text className="text-xs text-white" numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  roleHero: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.accent, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.4),
  },
  suspendedHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.danger, 0.12),
  },
  section: {
    backgroundColor: colors.overlayWhite4,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  note: {
    backgroundColor: withAlpha(colors.warning, 0.1),
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: withAlpha(colors.warning, 0.3),
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  presetBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.overlayWhite15,
    backgroundColor: colors.glass,
  },
  presetBtnSelected: {
    borderColor: colors.primary,
    backgroundColor: withAlpha(colors.accent, 0.1),
  },
});
