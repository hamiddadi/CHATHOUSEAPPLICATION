import React, { useCallback } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../shared/components/Avatar';
import { Button } from '../../../shared/components/Button';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Loader } from '../../../shared/components/Loader';
import { colors, spacing } from '../../../shared/constants/theme';
import { AdminHeader } from '../components/AdminHeader';
import {
  useAdminUser,
  useAdminWhoami,
  useDeleteUser,
  useSetUserRole,
  useSuspendUser,
  useUnsuspendUser,
} from '../hooks/useAdmin';
import { useImpersonationStore } from '../store/impersonationStore';
import { isAtLeast, ROLE_RANK, type AppRole } from '../types/admin.types';
import { formatDate, formatDateTime } from '../../../shared/utils/intl';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';

const ASSIGNABLE_ROLES: AppRole[] = ['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

const SUSPEND_PRESETS: readonly { id: string; label: string; minutes?: number }[] = [
  { id: '1h', label: '1 heure', minutes: 60 },
  { id: '24h', label: '24 heures', minutes: 60 * 24 },
  { id: '7d', label: '7 jours', minutes: 60 * 24 * 7 },
  { id: 'perm', label: 'Permanent' }, // minutes undefined → permanent
];

export const AdminUserDetailScreen: React.FC<SettingsStackScreenProps<'AdminUserDetail'>> = ({
  route,
  navigation,
}) => {
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
        'Changer de rôle',
        `Promouvoir/rétrograder @${user.username ?? user.id} → ${role} ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Confirmer',
            style: 'destructive',
            onPress: () =>
              setRole.mutate(
                { userId: user.id, role },
                {
                  onError: e => Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec'),
                },
              ),
          },
        ],
      );
    },
    [setRole, user],
  );

  const handleSuspend = useCallback(
    (minutes: number | undefined) => {
      if (!user) return;
      const fire = (motif: string): void => {
        suspend.mutate(
          { userId: user.id, reason: motif, durationMinutes: minutes },
          {
            onError: e => Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec'),
          },
        );
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prompt = (Alert as any).prompt as
        | undefined
        | ((
            title: string,
            message?: string,
            buttons?: {
              text?: string;
              style?: 'default' | 'cancel' | 'destructive';
              onPress?: (text: string | undefined) => void;
            }[],
            type?: 'default' | 'plain-text' | 'secure-text' | 'login-password',
          ) => void);
      if (prompt) {
        prompt(
          'Suspendre',
          'Motif (visible dans le journal d’audit)',
          [
            { text: 'Annuler', style: 'cancel' },
            {
              text: 'Suspendre',
              style: 'destructive',
              onPress: (text: string | undefined) =>
                fire((text ?? '').trim() || 'Sanction modération'),
            },
          ],
          'plain-text',
        );
      } else {
        fire('Sanction modération');
      }
    },
    [suspend, user],
  );

  const handleUnsuspend = useCallback(() => {
    if (!user) return;
    Alert.alert('Lever la suspension', `Réactiver @${user.username ?? user.id} ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer',
        onPress: () =>
          unsuspend.mutate(user.id, {
            onError: e => Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec'),
          }),
      },
    ]);
  }, [unsuspend, user]);

  const handleImpersonate = useCallback(() => {
    if (!user) return;
    Alert.alert(
      'Impersonation',
      `Démarrer une session de 15 min en tant que @${user.username ?? user.id} ?\n\nCette action est tracée dans le journal d'audit.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Démarrer',
          style: 'destructive',
          onPress: async () => {
            try {
              await startImpersonation(user.id);
              navigation.popToTop();
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
            }
          },
        },
      ],
    );
  }, [navigation, startImpersonation, user]);

  const handleDelete = useCallback(() => {
    if (!user) return;
    Alert.alert(
      'Supprimer le compte',
      `⚠️ Action quasi-irréversible. Le compte @${user.username ?? user.id} sera marqué pour suppression et définitivement banni. Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () =>
            del.mutate(user.id, {
              onSuccess: () => navigation.goBack(),
              onError: e => Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec'),
            }),
        },
      ],
    );
  }, [del, navigation, user]);

  if (isLoading) return <Loader fullscreen accessibilityLabel="Chargement…" />;
  if (isError || !user) {
    return <EmptyState title="Utilisateur introuvable" description="" />;
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader
        title={user.displayName ?? user.username ?? 'Utilisateur'}
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
                Suspendu jusqu&apos;au {formatDateTime(user.suspendedUntil)}
              </Text>
            </View>
          ) : null}
          {user.suspensionReason ? (
            <Text className="text-xs text-ink-dim text-center">
              Motif : {user.suspensionReason}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informations</Text>
          <Field label="Email" value={user.email ?? '—'} />
          <Field label="Téléphone" value={user.phoneNumber ?? '—'} />
          <Field label="Inscrit le" value={formatDate(user.createdAt)} />
          <Field label="Dernière activité" value={formatDateTime(user.lastSeenAt)} />
          <Field
            label="Followers / following"
            value={`${user.followerCount} / ${user.followingCount}`}
          />
        </View>

        {!canActOnTarget ? (
          <View style={styles.note}>
            <Text className="text-xs text-ink-dim">
              Vous ne pouvez pas modifier un compte de rang équivalent ou supérieur au vôtre.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Suspension</Text>
              {isSuspended ? (
                <Button
                  label="Lever la suspension"
                  variant="primaryContainer"
                  fullWidth
                  loading={unsuspend.isPending}
                  onPress={handleUnsuspend}
                />
              ) : (
                <View style={styles.presetGrid}>
                  {SUSPEND_PRESETS.map(p => (
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
                <Text style={styles.sectionTitle}>Rôle plateforme</Text>
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
                        accessibilityState={{ selected }}
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
                  <Text style={styles.sectionTitle}>Investigation</Text>
                  <Button
                    label="Voir comme cet utilisateur"
                    variant="primaryContainer"
                    fullWidth
                    onPress={handleImpersonate}
                  />
                  <Text className="text-xs text-ink-dim">
                    Session 15 min, tracée. Toutes les actions effectuées seront attribuées à cet
                    utilisateur dans la base, mais le journal d&apos;audit conservera votre identité
                    d&apos;administrateur.
                  </Text>
                </View>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Zone dangereuse</Text>
                  <Button
                    label="Supprimer le compte"
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
    borderRadius: 999,
    backgroundColor: 'rgba(0,228,117,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,228,117,0.4)',
  },
  suspendedHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
    backgroundColor: 'rgba(255,179,0,0.1)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,179,0,0.3)',
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  presetBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  presetBtnSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0,228,117,0.1)',
  },
});
