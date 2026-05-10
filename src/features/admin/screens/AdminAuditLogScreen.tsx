import React, { memo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../shared/components/Avatar';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Loader } from '../../../shared/components/Loader';
import { colors, spacing } from '../../../shared/constants/theme';
import { AdminHeader } from '../components/AdminHeader';
import { useAdminAuditLog } from '../hooks/useAdmin';
import type { AdminAuditLogEntry, AuditAction } from '../types/admin.types';
import { formatDateTime } from '../../../shared/utils/intl';

const ACTION_ICON: Record<AuditAction, React.ComponentProps<typeof MaterialIcons>['name']> = {
  USER_ROLE_CHANGED: 'star',
  USER_SUSPENDED: 'block',
  USER_UNSUSPENDED: 'lock-open',
  USER_DELETED: 'delete',
  ROOM_FORCE_ENDED: 'stop-circle',
  REPORT_RESOLVED: 'check-circle',
  REPORT_DISMISSED: 'do-not-disturb',
  GODMODE_ACCESS: 'visibility',
  IMPERSONATION_STARTED: 'person',
  IMPERSONATION_ENDED: 'person-off',
};

const ACTION_LABEL: Record<AuditAction, string> = {
  USER_ROLE_CHANGED: 'Rôle modifié',
  USER_SUSPENDED: 'Suspension',
  USER_UNSUSPENDED: 'Suspension levée',
  USER_DELETED: 'Compte supprimé',
  ROOM_FORCE_ENDED: 'Room fermée',
  REPORT_RESOLVED: 'Signalement résolu',
  REPORT_DISMISSED: 'Signalement rejeté',
  GODMODE_ACCESS: 'Accès Godmode',
  IMPERSONATION_STARTED: 'Impersonation',
  IMPERSONATION_ENDED: 'Fin d’impersonation',
};

const formatMeta = (meta: Record<string, unknown> | null): string => {
  if (!meta) return '';
  const parts: string[] = [];
  if (typeof meta.from === 'string' && typeof meta.to === 'string') {
    parts.push(`${meta.from} → ${meta.to}`);
  }
  if (typeof meta.reason === 'string') parts.push(`motif : ${meta.reason}`);
  if (typeof meta.until === 'string') {
    parts.push(`jusqu'au ${formatDateTime(meta.until)}`);
  }
  if (typeof meta.title === 'string') parts.push(`"${meta.title}"`);
  return parts.join(' · ');
};

const Row: React.FC<{ entry: AdminAuditLogEntry }> = memo(({ entry }) => {
  const icon = ACTION_ICON[entry.action];
  const label = ACTION_LABEL[entry.action];
  return (
    <View style={styles.row}>
      <View style={styles.iconWrap}>
        <MaterialIcons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.entryInfo}>
        <Text className="text-sm font-body-bold text-white">{label}</Text>
        <View style={styles.actorLine}>
          {entry.actor ? (
            <>
              <Avatar
                uri={entry.actor.avatarUrl ?? undefined}
                name={entry.actor.displayName ?? entry.actor.username ?? '?'}
                sizeValue={18}
              />
              <Text className="text-xs text-ink-muted" numberOfLines={1}>
                @{entry.actor.username ?? '—'}
              </Text>
            </>
          ) : null}
          {entry.targetUser ? (
            <>
              <MaterialIcons name="arrow-forward" size={12} color={colors.textMuted} />
              <Avatar
                uri={entry.targetUser.avatarUrl ?? undefined}
                name={entry.targetUser.displayName ?? entry.targetUser.username ?? '?'}
                sizeValue={18}
              />
              <Text className="text-xs text-ink-muted" numberOfLines={1}>
                @{entry.targetUser.username ?? '—'}
              </Text>
            </>
          ) : null}
        </View>
        {entry.metadata ? (
          <Text className="text-xs text-ink-dim mt-xxs" numberOfLines={2}>
            {formatMeta(entry.metadata)}
          </Text>
        ) : null}
        <Text className="text-[10px] text-ink-dim mt-xxs">
          {formatDateTime(entry.createdAt)}
          {entry.ip ? ` · ${entry.ip}` : ''}
        </Text>
      </View>
    </View>
  );
});
Row.displayName = 'Row';

export const AdminAuditLogScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch } = useAdminAuditLog({ limit: 100 });

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader title="Journal d'audit" subtitle="100 dernières actions privilégiées" />
      <View className="px-xxl" />

      {isLoading ? (
        <Loader fullscreen accessibilityLabel="Chargement…" />
      ) : isError || !data ? (
        <EmptyState title="Erreur" description="Impossible de charger le journal." />
      ) : (
        <FlatList
          data={data.data}
          renderItem={({ item }) => <Row entry={item} />}
          keyExtractor={e => e.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + spacing.giant,
          }}
          ListEmptyComponent={<EmptyState title="Vide" description="Aucune action enregistrée." />}
          onRefresh={refetch}
          refreshing={isLoading}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,228,117,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  entryInfo: { flex: 1 },
});
