import React, { memo, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../../../shared/constants/theme';
import type { HouseSummary, RoomSummary } from '../../../../../shared/types/domain';

interface HouseRowProps {
  house: HouseSummary;
  onPress: (id: string) => void;
}

const HouseRow: React.FC<HouseRowProps> = memo(({ house, onPress }) => {
  const handle = useCallback(() => onPress(house.id), [house.id, onPress]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={house.name}
      className="flex-row items-center gap-md py-sm"
    >
      <View className="w-10 h-10 rounded-md bg-surface-container items-center justify-center">
        <Text className="text-lg">{house.categoryEmoji}</Text>
      </View>
      <View className="flex-1 gap-xxs">
        <Text className="text-md font-body-medium text-ink" numberOfLines={1}>
          {house.name}
        </Text>
        <Text className="text-xs text-ink-muted" numberOfLines={1}>
          {house.membersCount} members · {house.privacy}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
  );
});
HouseRow.displayName = 'HouseRow';

interface HistoryRowProps {
  room: RoomSummary;
  onPress: (id: string) => void;
}

const HistoryRow: React.FC<HistoryRowProps> = memo(({ room, onPress }) => {
  const handle = useCallback(() => onPress(room.id), [onPress, room.id]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={room.title}
      className="flex-row items-center gap-md py-sm"
    >
      <View className="w-10 h-10 rounded-md bg-surface-container items-center justify-center">
        <Text className="text-lg">{room.categoryEmoji}</Text>
      </View>
      <View className="flex-1 gap-xxs">
        <Text className="text-md font-body-medium text-ink" numberOfLines={1}>
          {room.title}
        </Text>
        <Text className="text-xs text-ink-muted" numberOfLines={1}>
          {room.speakersCount} speakers · {room.listenersCount} listeners
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
  );
});
HistoryRow.displayName = 'HistoryRow';

interface SelfSectionsProps {
  houses: HouseSummary[] | undefined;
  housesLoading: boolean;
  rooms: RoomSummary[] | undefined;
  roomsLoading: boolean;
  onSeeAllHouses: () => void;
  onHousePress: (id: string) => void;
  onRoomPress: (id: string) => void;
}

const SelfSections: React.FC<SelfSectionsProps> = memo(
  ({ houses, housesLoading, rooms, roomsLoading, onSeeAllHouses, onHousePress, onRoomPress }) => {
    const { t } = useTranslation();
    return (
      <View className="gap-xl mt-xl">
        <View className="gap-sm">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-body-bold text-ink-muted uppercase tracking-wider">
              {t('profile.myHouses')}
            </Text>
            {(houses?.length ?? 0) > 0 && (
              <Pressable onPress={onSeeAllHouses} accessibilityRole="button" hitSlop={8}>
                <Text className="text-xs font-body-bold text-primary">{t('profile.seeAll')}</Text>
              </Pressable>
            )}
          </View>
          {housesLoading ? (
            <Text className="text-xs text-ink-dim">…</Text>
          ) : !houses || houses.length === 0 ? (
            <Text className="text-sm text-ink-dim">{t('profile.emptyMyHouses')}</Text>
          ) : (
            houses.slice(0, 5).map(h => <HouseRow key={h.id} house={h} onPress={onHousePress} />)
          )}
        </View>

        <View className="gap-sm">
          <Text className="text-sm font-body-bold text-ink-muted uppercase tracking-wider">
            {t('profile.recentRooms')}
          </Text>
          {roomsLoading ? (
            <Text className="text-xs text-ink-dim">…</Text>
          ) : !rooms || rooms.length === 0 ? (
            <Text className="text-sm text-ink-dim">{t('profile.emptyRecentRooms')}</Text>
          ) : (
            rooms.map(r => <HistoryRow key={r.id} room={r} onPress={onRoomPress} />)
          )}
        </View>
      </View>
    );
  },
);
SelfSections.displayName = 'SelfSections';

export default SelfSections;
