import React, { memo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Avatar } from '../../../shared/components/Avatar';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Loader } from '../../../shared/components/Loader';
import { colors, radii, spacing, withAlpha } from '../../../shared/constants/theme';
import { AdminHeader } from '../components/AdminHeader';
import { useAdminReports, useResolveReport } from '../hooks/useAdmin';
import type { AdminReport } from '../types/admin.types';
import { formatDateTime } from '../../../shared/utils/intl';
import { errorMessage } from '../../../shared/utils/errorMessage';

const getTabs = (t: TFunction): { id: 'open' | 'resolved' | 'all'; label: string }[] => [
  { id: 'open', label: t('admin.reports.tabs.open') },
  { id: 'resolved', label: t('admin.reports.tabs.resolved') },
  { id: 'all', label: t('admin.reports.tabs.all') },
];

const ReportRow: React.FC<{
  report: AdminReport;
  onResolve: (id: string, outcome: 'resolved' | 'dismissed') => void;
  busy: boolean;
}> = memo(({ report, onResolve, busy }) => {
  const { t } = useTranslation();
  const target = report.targetKind === 'USER' ? report.reported : null;
  const room = report.reportedRoom;
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <View style={styles.kindBadge}>
          <Text className="text-[9px] font-body-bold uppercase tracking-widest text-primary">
            {report.targetKind} · {report.reason}
          </Text>
        </View>
        {report.resolvedAt ? (
          <View style={styles.resolvedBadge}>
            <Text className="text-[9px] font-body-bold text-ink-dim">
              {t('admin.reports.resolvedBadge')}
            </Text>
          </View>
        ) : null}
      </View>

      {target ? (
        <View style={styles.party}>
          <Avatar
            uri={target.avatarUrl ?? undefined}
            name={target.displayName ?? target.username ?? '?'}
            sizeValue={32}
          />
          <View style={styles.partyInfo}>
            <Text className="text-sm font-body-bold text-white" numberOfLines={1}>
              {t('admin.reports.target')} : {target.displayName ?? target.username ?? '—'}
            </Text>
            <Text className="text-xs text-ink-muted">@{target.username ?? '—'}</Text>
          </View>
        </View>
      ) : null}

      {room ? (
        <View style={styles.party}>
          <View style={styles.roomIcon}>
            <Text className="text-md">🎙️</Text>
          </View>
          <View style={styles.partyInfo}>
            <Text className="text-sm font-body-bold text-white" numberOfLines={1}>
              {t('admin.reports.room')} : {room.title}
            </Text>
            <Text className="text-xs text-ink-muted">
              {room.isLive ? t('admin.reports.roomLive') : t('admin.reports.roomEnded')}
            </Text>
          </View>
        </View>
      ) : null}

      {report.reporter ? (
        <Text className="text-xs text-ink-dim">
          {t('admin.reports.reportedBy')} @{report.reporter.username ?? '—'} ·{' '}
          {formatDateTime(report.createdAt)}
        </Text>
      ) : null}

      {report.details ? (
        <Text className="text-sm text-ink" numberOfLines={4}>
          “{report.details}”
        </Text>
      ) : null}

      {!report.resolvedAt ? (
        <View style={styles.actions}>
          <Pressable
            disabled={busy}
            onPress={() => onResolve(report.id, 'dismissed')}
            style={[styles.actionBtn, styles.actionDismiss]}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel={t('admin.reports.dismissA11y')}
          >
            <Text className="text-xs font-body-bold text-ink-muted">
              {t('admin.reports.dismiss')}
            </Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => onResolve(report.id, 'resolved')}
            style={[styles.actionBtn, styles.actionResolve]}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            accessibilityLabel={t('admin.reports.resolveA11y')}
          >
            <Text className="text-xs font-body-bold text-white">{t('admin.reports.resolve')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});
ReportRow.displayName = 'ReportRow';

export const AdminReportsScreen: React.FC = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open');
  const { data, isLoading, isError, refetch, isRefetching } = useAdminReports({ status: tab });
  const resolve = useResolveReport();

  const handleResolve = (reportId: string, outcome: 'resolved' | 'dismissed') => {
    const isResolve = outcome === 'resolved';
    // Resolving/dismissing closes a moderation report — confirm before the
    // irreversible mutation rather than firing on a single tap.
    Alert.alert(
      isResolve ? t('admin.reports.confirmResolveTitle') : t('admin.reports.confirmDismissTitle'),
      isResolve ? t('admin.reports.confirmResolveBody') : t('admin.reports.confirmDismissBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: isResolve ? t('admin.reports.resolve') : t('admin.reports.dismiss'),
          style: isResolve ? 'default' : 'destructive',
          onPress: () =>
            resolve.mutate(
              { reportId, outcome },
              {
                onError: e =>
                  Alert.alert(
                    t('admin.reports.errorTitle'),
                    errorMessage(e, t('admin.reports.actionFailed')),
                  ),
              },
            ),
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader title={t('admin.reports.title')} />
      <View className="px-xxl gap-md">
        <View style={styles.tabRow}>
          {getTabs(t).map(tObj => {
            const selected = tab === tObj.id;
            return (
              <Pressable
                key={tObj.id}
                onPress={() => setTab(tObj.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.tabPill, selected ? styles.tabPillOn : styles.tabPillOff]}
              >
                <Text
                  className={
                    selected
                      ? 'text-xs font-body-bold text-primary-on-container'
                      : 'text-xs font-body-bold text-ink-muted'
                  }
                >
                  {tObj.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading', 'Loading…')} />
      ) : isError || !data ? (
        <EmptyState
          title={t('admin.reports.errorTitle')}
          description={t('admin.reports.errorBody')}
        />
      ) : (
        <FlatList
          data={data.data}
          renderItem={({ item }) => (
            <ReportRow
              report={item}
              onResolve={handleResolve}
              busy={resolve.isPending && resolve.variables?.reportId === item.id}
            />
          )}
          keyExtractor={r => r.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + spacing.giant,
          }}
          ListEmptyComponent={
            <EmptyState
              title={t('admin.reports.emptyTitle')}
              description={
                tab === 'open' ? t('admin.reports.emptyOpen') : t('admin.reports.emptyAll')
              }
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
  tabRow: { flexDirection: 'row', gap: spacing.xs },
  tabPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  tabPillOff: { borderColor: colors.overlayWhite15, backgroundColor: 'transparent' },
  row: {
    backgroundColor: colors.overlayWhite4,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.xs,
    backgroundColor: withAlpha(colors.accent, 0.1),
  },
  resolvedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.xs,
    backgroundColor: colors.overlayWhite5,
  },
  party: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  roomIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: withAlpha(colors.accent, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDismiss: {
    borderWidth: 1,
    borderColor: colors.overlayWhite15,
  },
  actionResolve: {
    backgroundColor: colors.primary,
  },
  partyInfo: { flex: 1 },
});
