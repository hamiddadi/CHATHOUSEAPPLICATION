import React, { memo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../shared/components/Avatar';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Loader } from '../../../shared/components/Loader';
import { colors, spacing } from '../../../shared/constants/theme';
import { AdminHeader } from '../components/AdminHeader';
import { useAdminReports, useResolveReport } from '../hooks/useAdmin';
import type { AdminReport } from '../types/admin.types';
import { formatDateTime } from '../../../shared/utils/intl';
import { errorMessage } from '../../../shared/utils/errorMessage';

const TABS: readonly { id: 'open' | 'resolved' | 'all'; label: string }[] = [
  { id: 'open', label: 'En attente' },
  { id: 'resolved', label: 'Traités' },
  { id: 'all', label: 'Tous' },
];

const ReportRow: React.FC<{
  report: AdminReport;
  onResolve: (id: string, outcome: 'resolved' | 'dismissed') => void;
  busy: boolean;
}> = memo(({ report, onResolve, busy }) => {
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
            <Text className="text-[9px] font-body-bold text-ink-dim">RÉSOLU</Text>
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
              Cible : {target.displayName ?? target.username ?? '—'}
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
              Room : {room.title}
            </Text>
            <Text className="text-xs text-ink-muted">{room.isLive ? 'En direct' : 'Terminée'}</Text>
          </View>
        </View>
      ) : null}

      {report.reporter ? (
        <Text className="text-xs text-ink-dim">
          Signalé par @{report.reporter.username ?? '—'} · {formatDateTime(report.createdAt)}
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
            accessibilityLabel="Rejeter ce signalement"
          >
            <Text className="text-xs font-body-bold text-ink-muted">Rejeter</Text>
          </Pressable>
          <Pressable
            disabled={busy}
            onPress={() => onResolve(report.id, 'resolved')}
            style={[styles.actionBtn, styles.actionResolve]}
            accessibilityRole="button"
            accessibilityLabel="Marquer comme résolu"
          >
            <Text className="text-xs font-body-bold text-white">Résolu</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});
ReportRow.displayName = 'ReportRow';

export const AdminReportsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open');
  const { data, isLoading, isError, refetch } = useAdminReports({ status: tab });
  const resolve = useResolveReport();

  const handleResolve = (reportId: string, outcome: 'resolved' | 'dismissed') => {
    resolve.mutate(
      { reportId, outcome },
      { onError: e => Alert.alert('Erreur', errorMessage(e, 'Échec')) },
    );
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader title="Signalements" />
      <View className="px-xxl gap-md">
        <View style={styles.tabRow}>
          {TABS.map(t => {
            const selected = tab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setTab(t.id)}
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
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel="Chargement…" />
      ) : isError || !data ? (
        <EmptyState title="Erreur" description="Impossible de charger la file." />
      ) : (
        <FlatList
          data={data.data}
          renderItem={({ item }) => (
            <ReportRow report={item} onResolve={handleResolve} busy={resolve.isPending} />
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
              title="Aucun signalement"
              description={
                tab === 'open' ? 'La file est vide — bonne nouvelle.' : 'Aucun élément à afficher.'
              }
            />
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
  tabRow: { flexDirection: 'row', gap: spacing.xs },
  tabPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
  },
  tabPillOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  tabPillOff: { borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'transparent' },
  row: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: spacing.sm,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(0,228,117,0.1)',
  },
  resolvedBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  party: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  roomIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(0,228,117,0.1)',
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
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDismiss: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  actionResolve: {
    backgroundColor: colors.primary,
  },
  partyInfo: { flex: 1 },
});
