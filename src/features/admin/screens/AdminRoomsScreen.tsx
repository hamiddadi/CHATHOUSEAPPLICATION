import React, { memo } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../shared/components/Avatar';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Loader } from '../../../shared/components/Loader';
import { colors, palette, radii, spacing, withAlpha } from '../../../shared/constants/theme';
import { errorMessage } from '../../../shared/utils/errorMessage';
import { AdminHeader } from '../components/AdminHeader';
import { useAdminRooms, useForceEndRoom } from '../hooks/useAdmin';
import { promptForReason } from '../promptForReason';
import type { AdminRoom } from '../types/admin.types';

const RoomRow: React.FC<{
  room: AdminRoom;
  onForceEnd: (id: string, title: string) => void;
  busy: boolean;
}> = memo(({ room, onForceEnd, busy }) => {
  const { t } = useTranslation();
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
            {t('admin.rooms.hostBy', 'by @{{username}} · {{count}} participants', {
              username: room.host.username ?? '—',
              count: participants,
            })}
          </Text>
        </View>
        {room.isLive ? (
          <View style={styles.liveBadge}>
            <Text className="text-[9px] font-body-bold text-danger">
              {t('admin.rooms.liveBadge', 'LIVE')}
            </Text>
          </View>
        ) : null}
      </View>
      <Pressable
        disabled={busy || !room.isLive}
        onPress={() => onForceEnd(room.id, room.title)}
        style={[styles.endBtn, !room.isLive && styles.endBtnDisabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !room.isLive }}
        accessibilityLabel={`${t('admin.rooms.closeRoom')} ${room.title}`}
      >
        <Text
          className="text-xs font-body-bold"
          style={{ color: room.isLive ? palette.onError : colors.textMuted }}
        >
          {room.isLive ? t('admin.rooms.closeRoom') : t('admin.rooms.ended', 'Ended')}
        </Text>
      </Pressable>
    </View>
  );
});
RoomRow.displayName = 'RoomRow';

export const AdminRoomsScreen: React.FC = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data: rooms, isLoading, isError, refetch, isRefetching } = useAdminRooms({ live: true });
  const forceEnd = useForceEndRoom();

  const handleForceEnd = (roomId: string) => {
    const fire = (reason: string) =>
      forceEnd.mutate(
        { roomId, reason },
        {
          onError: e =>
            Alert.alert(
              t('common.error', 'Error'),
              errorMessage(e, t('admin.rooms.failedEnd', 'Failed to close the room.')),
            ),
        },
      );
    promptForReason(
      {
        title: t('admin.rooms.closeRoom'),
        message: t('admin.rooms.confirmClose'),
        confirmLabel: 'OK',
        defaultReason: 'Admin',
        androidConfirm: { message: t('admin.rooms.confirmClose'), confirmLabel: 'OK' },
      },
      fire,
    );
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <AdminHeader title={t('admin.rooms.liveRooms', 'Live Rooms')} />
      <View className="px-xxl">
        <Text className="text-xs text-ink-muted">
          {t(
            'admin.rooms.forceEndNotice',
            'Forcing termination notifies all participants and closes the LiveKit channel.',
          )}
        </Text>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading', 'Loading…')} />
      ) : isError || !rooms ? (
        <EmptyState
          title={t('common.error', 'Error')}
          description={t('admin.rooms.errorLoadingRooms', 'Unable to load rooms.')}
        />
      ) : (
        <FlatList
          data={rooms}
          renderItem={({ item }) => (
            <RoomRow
              room={item}
              onForceEnd={handleForceEnd}
              busy={forceEnd.isPending && forceEnd.variables?.roomId === item.id}
            />
          )}
          keyExtractor={r => r.id}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + spacing.giant,
          }}
          ListEmptyComponent={<EmptyState title={t('admin.rooms.empty')} description="" />}
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
    backgroundColor: colors.overlayWhite4,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    gap: spacing.sm,
  },
  host: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.xs,
    backgroundColor: withAlpha(colors.danger, 0.15),
  },
  endBtn: {
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
  },
  endBtnDisabled: { backgroundColor: colors.borderSoft },
  hostInfo: { flex: 1 },
});
