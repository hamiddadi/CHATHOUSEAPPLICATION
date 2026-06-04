import React, { memo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Avatar } from '../../../shared/components/Avatar';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Loader } from '../../../shared/components/Loader';
import { colors, radii, spacing, withAlpha } from '../../../shared/constants/theme';
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

// Labels moved inside the component to use t()
const getActionLabel = (action: AuditAction, t: TFunction): string => {
  const map: Record<AuditAction, string> = {
    USER_ROLE_CHANGED: t('admin.audit.roles.changed'),
    USER_SUSPENDED: t('admin.audit.roles.suspended'),
    USER_UNSUSPENDED: t('admin.audit.roles.unsuspended'),
    USER_DELETED: t('admin.audit.roles.deleted'),
    ROOM_FORCE_ENDED: t('admin.audit.roles.roomEnded'),
    REPORT_RESOLVED: t('admin.audit.roles.reportResolved'),
    REPORT_DISMISSED: t('admin.audit.roles.reportDismissed'),
    GODMODE_ACCESS: t('admin.audit.roles.godmode'),
    IMPERSONATION_STARTED: t('admin.audit.roles.impersonationStarted'),
    IMPERSONATION_ENDED: t('admin.audit.roles.impersonationEnded'),
  };
  return map[action];
};

const formatMeta = (meta: Record<string, unknown> | null, t: TFunction): string => {
  if (!meta) return '';
  const parts: string[] = [];
  if (typeof meta.from === 'string' && typeof meta.to === 'string') {
    parts.push(`${meta.from} → ${meta.to}`);
  }
  if (typeof meta.reason === 'string') parts.push(`${t('admin.audit.reason')} : ${meta.reason}`);
  if (typeof meta.until === 'string') {
    parts.push(`${t('admin.audit.until')} ${formatDateTime(meta.until)}`);
  }
  if (typeof meta.title === 'string') parts.push(`"${meta.title}"`);
  return parts.join(' · ');
};

const Row: React.FC<{ entry: AdminAuditLogEntry }> = memo(({ entry }) => {
  const { t } = useTranslation();
  const icon = ACTION_ICON[entry.action];
  const label = getActionLabel(entry.action, t);
  const actorName = entry.actor
    ? (entry.actor.displayName ?? (entry.actor.username ? `@${entry.actor.username}` : '—'))
    : null;
  const targetName = entry.targetUser
    ? (entry.targetUser.displayName ??
      (entry.targetUser.username ? `@${entry.targetUser.username}` : '—'))
    : null;
  const a11yLabel = [
    actorName,
    targetName ? `→ ${targetName}` : null,
    label,
    formatDateTime(entry.createdAt),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.row} accessible accessibilityLabel={a11yLabel}>
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
            {formatMeta(entry.metadata, t)}
          </Text>
        ) : null}
        <Text className="text-xxs text-ink-dim mt-xxs">
          {formatDateTime(entry.createdAt)}
          {entry.ip ? ` · ${entry.ip}` : ''}
        </Text>
      </View>
    </View>
  );
});
Row.displayName = 'Row';

export const AdminAuditLogScreen: React.FC = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch, isRefetching } = useAdminAuditLog({ limit: 100 });

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader title={t('admin.audit.title')} subtitle={t('admin.audit.subtitle')} />

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading', 'Loading…')} />
      ) : isError || !data ? (
        <EmptyState title={t('admin.audit.errorTitle')} description={t('admin.audit.errorBody')} />
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
          ListEmptyComponent={
            <EmptyState
              title={t('admin.audit.emptyTitle')}
              description={t('admin.audit.emptyBody')}
            />
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
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.overlayWhite4,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.glassStrong,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radii.lg,
    backgroundColor: withAlpha(colors.accent, 0.1),
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
