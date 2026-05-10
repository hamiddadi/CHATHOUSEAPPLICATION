import React, { memo } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../shared/components/Avatar';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Loader } from '../../../shared/components/Loader';
import { colors, spacing } from '../../../shared/constants/theme';
import { AdminHeader } from '../components/AdminHeader';
import { useAdminRooms, useForceEndRoom } from '../hooks/useAdmin';
import type { AdminRoom } from '../types/admin.types';

const RoomRow: React.FC<{
  room: AdminRoom;
  onForceEnd: (id: string, title: string) => void;
  busy: boolean;
}> = memo(({ room, onForceEnd, busy }) => {
  const participants = room._count?.participants ?? room.participantCount;
  return (
    <View style={styles.row}>
      <View style={styles.host}>
        <Avatar
          uri={room.host.avatarUrl ?? undefined}
          name={room.host.displayName ?? room.host.username ?? '?'}
          sizeValue={32}
        />
        <View style={styles.hostInfo}>
          <Text className="text-sm font-body-bold text-white" numberOfLines={1}>
            {room.title}
          </Text>
          <Text className="text-xs text-ink-muted">
            par @{room.host.username ?? '—'} · {participants} participant·e·s
          </Text>
        </View>
        {room.isLive ? (
          <View style={styles.liveBadge}>
            <Text className="text-[9px] font-body-bold text-danger">LIVE</Text>
          </View>
        ) : null}
      </View>
      <Pressable
        disabled={busy || !room.isLive}
        onPress={() => onForceEnd(room.id, room.title)}
        style={[styles.endBtn, !room.isLive && styles.endBtnDisabled]}
        accessibilityRole="button"
        accessibilityLabel={`Forcer la fin de ${room.title}`}
      >
        <Text className="text-xs font-body-bold text-white">
          {room.isLive ? 'Forcer la fin' : 'Terminée'}
        </Text>
      </Pressable>
    </View>
  );
});
RoomRow.displayName = 'RoomRow';

export const AdminRoomsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { data: rooms, isLoading, isError, refetch } = useAdminRooms({ live: true });
  const forceEnd = useForceEndRoom();

  const handleForceEnd = (roomId: string, title: string) => {
    // Alert.prompt is iOS-only; on Android we fall back to a generic reason.
    const fire = (reason: string) =>
      forceEnd.mutate(
        { roomId, reason },
        { onError: e => Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec') },
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((Alert as any).prompt) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Alert as any).prompt(
        'Forcer la fin',
        `"${title}" sera fermée pour tous les participants.\n\nMotif :`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Fermer',
            style: 'destructive',
            onPress: (text: string | undefined) => fire((text ?? '').trim() || 'Fermeture admin'),
          },
        ],
        'plain-text',
      );
    } else {
      Alert.alert('Forcer la fin', `Fermer "${title}" ?`, [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          style: 'destructive',
          onPress: () => fire('Fermeture admin'),
        },
      ]);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader title="Rooms en direct" />
      <View className="px-xxl">
        <Text className="text-xs text-ink-muted">
          Forcer la fin notifie tous les participants et ferme le canal Agora.
        </Text>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel="Chargement…" />
      ) : isError || !rooms ? (
        <EmptyState title="Erreur" description="Impossible de charger les rooms." />
      ) : (
        <FlatList
          data={rooms}
          renderItem={({ item }) => (
            <RoomRow room={item} onForceEnd={handleForceEnd} busy={forceEnd.isPending} />
          )}
          keyExtractor={r => r.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + spacing.giant,
          }}
          ListEmptyComponent={
            <EmptyState title="Aucune room en direct" description="Tout est calme." />
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
  row: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: spacing.sm,
  },
  host: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  endBtn: {
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.danger,
    alignItems: 'center',
  },
  endBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.1)' },
  hostInfo: { flex: 1 },
});
