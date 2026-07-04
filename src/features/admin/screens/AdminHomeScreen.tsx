import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import Clipboard from '@react-native-clipboard/clipboard';
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
    // flexBasis 48% keeps two cards per row without overflowing narrow (320dp)
    // screens — the old min-w-[140px] forced 140×2 + gap > 320.
    <View className={`rounded-md border ${toneClass} p-md gap-xs`} style={styles.kpiCard}>
      <Text className="text-xxs font-body-bold uppercase tracking-widest text-ink-muted">
        {label}
      </Text>
      <Text className="text-3xl font-display text-white" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
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
  const { data: stats, isLoading, isError, refetch, isRefetching } = useAdminStats();

  const goUsers = useCallback(() => navigation.navigate('AdminUsers'), [navigation]);
  const goReports = useCallback(() => navigation.navigate('AdminReports'), [navigation]);
  const goRooms = useCallback(() => navigation.navigate('AdminRooms'), [navigation]);
  const goAuditLog = useCallback(() => navigation.navigate('AdminAuditLog'), [navigation]);

  const [exporting, setExporting] = useState<null | 'users' | 'audit-log' | 'reports'>(null);
  // Last exported CSV, kept in memory for the explicit opt-in clipboard copy.
  // It is NEVER auto-copied: PII (emails/phones) must not silently persist in
  // the system clipboard where other apps can read it. Sharing is the default.
  const lastExportRef = useRef<{ kind: string; csv: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleExport = useCallback(
    async (kind: 'users' | 'audit-log' | 'reports') => {
      setExporting(kind);
      setCopied(false);
      try {
        const csv = await adminService.exportCsv(kind);
        lastExportRef.current = { kind, csv };
        // Default hand-off is the native Share sheet, which carries the export
        // to a destination the operator picks — no silent clipboard write.
        await Share.share({
          message: csv,
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

  // Explicit, opt-in clipboard copy — gated behind a confirmation that warns
  // the CSV contains PII and stays readable by other apps until cleared.
  const handleCopyLastExport = useCallback(() => {
    const last = lastExportRef.current;
    if (!last) return;
    Alert.alert(
      t('admin.home.copyWarnTitle', 'Copy to clipboard?'),
      t(
        'admin.home.copyWarnBody',
        'This CSV contains personal data (emails, phone numbers). It will stay readable by other apps until you clear the clipboard.',
      ),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('admin.home.copyConfirm', 'Copy'),
          style: 'destructive',
          onPress: () => {
            Clipboard.setString(last.csv);
            setCopied(true);
          },
        },
      ],
    );
  }, [t]);

  const handleClearClipboard = useCallback(() => {
    Clipboard.setString('');
    setCopied(false);
  }, []);

  if (isLoading)
    return (
      <Loader fullscreen accessibilityLabel={t('admin.home.loading', 'Loading admin stats')} />
    );
  if (isError || !stats) {
    return (
      <EmptyState
        title={t('common.error', 'Error')}
        description={t('admin.home.errorStats', 'Unable to load stats.')}
        actionLabel={t('common.retry', 'Retry')}
        onAction={() => void refetch()}
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
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.primary}
          />
        }
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
                'Opens the native share sheet. Copying to the clipboard is optional (contains personal data).',
              )}
            </Text>
            <Pressable
              onPress={handleCopyLastExport}
              style={styles.copyBtn}
              accessibilityRole="button"
              accessibilityLabel={t('admin.home.csvCopyA11y', 'Copy the last export to clipboard')}
              accessibilityHint={t(
                'admin.home.copyWarnBody',
                'This CSV contains personal data (emails, phone numbers). It will stay readable by other apps until you clear the clipboard.',
              )}
            >
              <MaterialIcons name="content-copy" size={16} color={colors.textMuted} />
              <Text className="text-xs font-body-bold text-ink-muted ml-xs">
                {t('admin.home.csvCopyLabel', 'Copy last export')}
              </Text>
            </Pressable>
            {copied ? (
              <Pressable
                onPress={handleClearClipboard}
                style={styles.copyBtn}
                accessibilityRole="button"
                accessibilityLabel={t('admin.home.csvClearA11y', 'Clear the clipboard')}
              >
                <MaterialIcons name="delete-outline" size={16} color={colors.textMuted} />
                <Text className="text-xs font-body-bold text-ink-muted ml-xs">
                  {t('admin.home.csvClearLabel', 'Clear clipboard')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  // flexBasis (not flex-1 + min-width) so two cards fit any width down to 320dp.
  kpiCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '48%',
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
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.overlayWhite15,
    alignSelf: 'flex-start',
  },
});
