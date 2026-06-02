import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../shared/components/Loader';
import { EmptyState } from '../../../shared/components/EmptyState';
import { colors, spacing, radii, withAlpha } from '../../../shared/constants/theme';
import { AdminHeader } from '../components/AdminHeader';
import { useAdminStats, useAdminWhoami } from '../hooks/useAdmin';
import { adminService } from '../services/adminService';
import { isAtLeast } from '../types/admin.types';
import { errorMessage } from '../../../shared/utils/errorMessage';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';

type Nav = SettingsStackScreenProps<'AdminHome'>['navigation'];

interface KpiCardProps {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'default' | 'warn' | 'danger' | 'good';
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, hint, tone = 'default' }) => {
  const toneClass =
    tone === 'danger'
      ? 'border-danger/40 bg-danger/10'
      : tone === 'warn'
        ? 'border-warning/40 bg-warning/10'
        : tone === 'good'
          ? 'border-primary/40 bg-primary/10'
          : 'border-overlay-white-10 bg-overlay-white-5';
  return (
    <View className={`flex-1 rounded-md border ${toneClass} p-md gap-xs min-w-[140px]`}>
      <Text className="text-xxs font-body-bold uppercase tracking-widest text-ink-muted">
        {label}
      </Text>
      <Text className="text-3xl font-display text-white">{value}</Text>
      {hint ? <Text className="text-xxs font-body text-ink-dim">{hint}</Text> : null}
    </View>
  );
};

interface NavTileProps {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  hint?: string;
  onPress: () => void;
  badge?: number;
}

const NavTile: React.FC<NavTileProps> = ({ icon, label, hint, onPress, badge }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    className="flex-row items-center gap-md p-md rounded-md bg-overlay-white-5 border border-overlay-white-10"
  >
    <View className="w-10 h-10 rounded-pill bg-primary/15 items-center justify-center">
      <MaterialIcons name={icon} size={20} color={colors.primary} />
    </View>
    <View className="flex-1">
      <Text className="text-md font-body-bold text-white">{label}</Text>
      {hint ? <Text className="text-xs text-ink-muted mt-xxs">{hint}</Text> : null}
    </View>
    {typeof badge === 'number' && badge > 0 ? (
      <View className="bg-danger rounded-pill px-sm py-xxs">
        <Text className="text-xs font-body-bold text-white">{badge > 99 ? '99+' : badge}</Text>
      </View>
    ) : null}
    <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
  </Pressable>
);

export const AdminHomeScreen: React.FC<SettingsStackScreenProps<'AdminHome'>> = ({
  navigation,
}: {
  navigation: Nav;
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data: me } = useAdminWhoami();
  const { data: stats, isLoading, isError } = useAdminStats();

  const goUsers = useCallback(() => navigation.navigate('AdminUsers'), [navigation]);
  const goReports = useCallback(() => navigation.navigate('AdminReports'), [navigation]);
  const goRooms = useCallback(() => navigation.navigate('AdminRooms'), [navigation]);
  const goAuditLog = useCallback(() => navigation.navigate('AdminAuditLog'), [navigation]);

  const [exporting, setExporting] = useState<null | 'users' | 'audit-log' | 'reports'>(null);
  const handleExport = useCallback(
    async (kind: 'users' | 'audit-log' | 'reports') => {
      setExporting(kind);
      try {
        const csv = await adminService.exportCsv(kind);
        // Two-step UX: copy to clipboard immediately, offer Share for
        // operators who want to forward the dump out of the device. For a
        // future iteration: write via expo-file-system + expo-sharing for
        // an actual file attachment.
        await Clipboard.setStringAsync(csv);
        await Share.share({
          message:
            csv.length > 50_000
              ? csv.slice(0, 50_000) + '\n…(truncated, full copy in clipboard)'
              : csv,
          title: `Chathouse · export ${kind}`,
        });
      } catch (e) {
        Alert.alert(
          t('common.error', 'Error'),
          errorMessage(e, t('admin.home.exportError', 'Export failed')),
        );
      } finally {
        setExporting(null);
      }
    },
    [t],
  );

  if (isLoading)
    return (
      <Loader fullscreen accessibilityLabel={t('admin.home.loading', 'Loading admin stats')} />
    );
  if (isError || !stats) {
    return (
      <EmptyState
        title={t('common.error', 'Error')}
        description={t('admin.home.errorStats', 'Unable to load stats.')}
      />
    );
  }

  const canSeeAuditLog = me ? isAtLeast(me.appRole, 'SUPER_ADMIN') : false;
  const canForceEnd = me ? isAtLeast(me.appRole, 'ADMIN') : false;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader
        title={t('settings.godmode', 'Godmode')}
        subtitle={t('admin.home.subtitle', 'Connected as {{role}}', { role: me?.appRole ?? '—' })}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingTop: spacing.lg,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.xxl,
        }}
      >
        <View className="gap-xs">
          <Text className="text-3xl font-display text-white">{t('admin.home.title')}</Text>
        </View>

        <View style={styles.kpiRow}>
          <KpiCard
            label={t('admin.home.stats.users', 'Users')}
            value={stats.users.total}
            hint={t('admin.home.stats.online', '{{count}} online', { count: stats.users.online })}
          />
          <KpiCard
            label={t('admin.home.stats.live', 'Live')}
            value={stats.rooms.live}
            hint={t('admin.home.stats.roomsTotal', '{{count}} rooms total', {
              count: stats.rooms.total,
            })}
            tone="good"
          />
        </View>
        <View style={styles.kpiRow}>
          <KpiCard
            label={t('admin.home.stats.reports', 'Reports')}
            value={stats.reports.open}
            hint={t('admin.home.stats.reportsHistory', '{{count}} history', {
              count: stats.reports.total,
            })}
            tone={stats.reports.open > 0 ? 'warn' : 'default'}
          />
          <KpiCard
            label={t('admin.home.stats.suspended', 'Suspended')}
            value={stats.users.suspended}
            tone={stats.users.suspended > 0 ? 'danger' : 'default'}
          />
        </View>
        <View style={styles.kpiRow}>
          <KpiCard
            label={t('admin.home.stats.new24h', 'New 24h')}
            value={`+${stats.users.new24h}`}
            hint={t('admin.home.stats.new7d', '+{{count}} over 7d', { count: stats.users.new7d })}
          />
          <KpiCard
            label={t('admin.home.stats.messages24h', 'Messages 24h')}
            value={stats.messages.last24h}
          />
        </View>

        <View className="gap-sm">
          <Text className="text-xs font-body-bold uppercase tracking-widest text-ink-muted">
            {t('admin.home.actions', 'Actions')}
          </Text>
          <NavTile
            icon="people"
            label={t('admin.home.users')}
            hint={t('admin.home.hints.users', 'Search, roles, suspensions')}
            onPress={goUsers}
          />
          <NavTile
            icon="flag"
            label={t('admin.home.reports')}
            hint={t('admin.home.hints.reports', 'Moderation queue')}
            badge={stats.reports.open}
            onPress={goReports}
          />
          {canForceEnd ? (
            <NavTile
              icon="stop-circle"
              label={t('admin.home.rooms')}
              hint={t('admin.home.hints.rooms', 'Force end a room')}
              badge={stats.rooms.live}
              onPress={goRooms}
            />
          ) : null}
          {canSeeAuditLog ? (
            <NavTile
              icon="history"
              label={t('admin.home.auditLog')}
              hint={t('admin.home.hints.auditLog', 'All privileged actions')}
              onPress={goAuditLog}
            />
          ) : null}
        </View>

        {canSeeAuditLog ? (
          <View className="gap-sm">
            <Text className="text-xs font-body-bold uppercase tracking-widest text-ink-muted">
              {t('admin.home.csvExports', 'CSV Exports')}
            </Text>
            <View style={styles.exportRow}>
              <Pressable
                disabled={exporting !== null}
                onPress={() => handleExport('users')}
                style={[styles.exportBtn, exporting === 'users' ? styles.exportBtnBusy : null]}
                accessibilityRole="button"
                accessibilityState={{ disabled: exporting !== null }}
                accessibilityLabel={t('admin.home.csvA11yUsers', 'Export users to CSV')}
              >
                <MaterialIcons name="people" size={16} color={colors.primary} />
                <Text className="text-xs font-body-bold text-white ml-xs">
                  {t('admin.home.csvUsersLabel', 'Users')}
                </Text>
              </Pressable>
              <Pressable
                disabled={exporting !== null}
                onPress={() => handleExport('audit-log')}
                style={[styles.exportBtn, exporting === 'audit-log' ? styles.exportBtnBusy : null]}
                accessibilityRole="button"
                accessibilityState={{ disabled: exporting !== null }}
                accessibilityLabel={t('admin.home.csvA11yAudit', 'Export audit log to CSV')}
              >
                <MaterialIcons name="history" size={16} color={colors.primary} />
                <Text className="text-xs font-body-bold text-white ml-xs">
                  {t('admin.home.csvAuditLabel', 'Audit log')}
                </Text>
              </Pressable>
              <Pressable
                disabled={exporting !== null}
                onPress={() => handleExport('reports')}
                style={[styles.exportBtn, exporting === 'reports' ? styles.exportBtnBusy : null]}
                accessibilityRole="button"
                accessibilityState={{ disabled: exporting !== null }}
                accessibilityLabel={t('admin.home.csvA11yReports', 'Export reports to CSV')}
              >
                <MaterialIcons name="flag" size={16} color={colors.primary} />
                <Text className="text-xs font-body-bold text-white ml-xs">
                  {t('admin.home.csvReportsLabel', 'Reports')}
                </Text>
              </Pressable>
            </View>
            <Text className="text-xxs text-ink-dim">
              {t(
                'admin.home.csvHint',
                'Content is copied to clipboard then opens the native share sheet.',
              )}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  kpiRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  exportRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.overlayWhite5,
    borderWidth: 1,
    borderColor: withAlpha(colors.accent, 0.3),
  },
  exportBtnBusy: { opacity: 0.5 },
});
