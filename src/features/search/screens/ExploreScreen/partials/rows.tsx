import React, { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { Avatar } from '../../../../../shared/components/Avatar';
import { colors } from '../../../../../shared/constants/theme';
import type { SearchRoomHit } from '../../../services/searchService';
import type { ExploreClubHit, ExploreUserHit } from '../../../services/exploreService';

export const RoomRow: React.FC<{ room: SearchRoomHit; onPress: (id: string) => void }> = memo(
  ({ room, onPress }) => (
    <Pressable
      onPress={() => onPress(room.id)}
      accessibilityRole="button"
      className="flex-row items-center gap-md py-md"
    >
      <View className="w-10 h-10 rounded-md bg-surface-container items-center justify-center">
        <MaterialIcons
          name={room.isLive ? 'mic' : 'schedule'}
          size={20}
          color={room.isLive ? colors.accent : colors.primary}
        />
      </View>
      <View className="flex-1 gap-xxs">
        <Text className="text-md font-body-medium text-ink" numberOfLines={1}>
          {room.title}
        </Text>
        <Text className="text-xs text-ink-muted" numberOfLines={1}>
          {room.host.displayName} · {room.listenersCount} listeners
        </Text>
      </View>
    </Pressable>
  ),
);
RoomRow.displayName = 'RoomRow';

// `liveRoomsCount`/`followersCount` are optional here so the search-results
// view can pass its raw hits (which omit those counts) without allocating a
// fresh `{ ...hit, count: 0 }` object on every render — that spread broke the
// `memo` reference equality and re-rendered every row on each keystroke.
export type ClubRowData =
  | ExploreClubHit
  | (Omit<ExploreClubHit, 'liveRoomsCount'> & { liveRoomsCount?: number });
export type UserRowData =
  | ExploreUserHit
  | (Omit<ExploreUserHit, 'followersCount'> & { followersCount?: number });

export const ClubRow: React.FC<{ club: ClubRowData; onPress: (id: string) => void }> = memo(
  ({ club, onPress }) => (
    <Pressable
      onPress={() => onPress(club.id)}
      accessibilityRole="button"
      className="flex-row items-center gap-md py-md"
    >
      <View className="w-10 h-10 rounded-md bg-surface-container items-center justify-center">
        <Text className="text-lg">{club.categoryEmoji}</Text>
      </View>
      <View className="flex-1 gap-xxs">
        <Text className="text-md font-body-medium text-ink" numberOfLines={1}>
          {club.name}
        </Text>
        <Text className="text-xs text-ink-muted" numberOfLines={1}>
          {club.membersCount} members · {club.liveRoomsCount ?? 0} live
        </Text>
      </View>
    </Pressable>
  ),
);
ClubRow.displayName = 'ClubRow';

export const UserRow: React.FC<{ user: UserRowData; onPress: (id: string) => void }> = memo(
  ({ user, onPress }) => (
    <Pressable
      onPress={() => onPress(user.id)}
      accessibilityRole="button"
      className="flex-row items-center gap-md py-md"
    >
      <Avatar uri={user.avatarUrl ?? undefined} name={user.displayName} sizeValue={40} />
      <View className="flex-1 gap-xxs">
        <Text className="text-md font-body-medium text-ink" numberOfLines={1}>
          {user.displayName}
        </Text>
        <Text className="text-xs text-ink-muted" numberOfLines={1}>
          @{user.username} · {user.followersCount ?? 0} followers
        </Text>
      </View>
    </Pressable>
  ),
);
UserRow.displayName = 'UserRow';

export interface SectionProps<T> {
  title: string;
  empty?: string;
  items?: readonly T[];
  render: (item: T) => React.ReactNode;
}

export function Section<T>({ title, empty, items, render }: SectionProps<T>) {
  return (
    <View>
      <Text className="text-sm font-body-bold text-ink-muted uppercase tracking-wider mb-md">
        {title}
      </Text>
      {!items || items.length === 0 ? (
        empty ? (
          <Text className="text-sm text-ink-dim">{empty}</Text>
        ) : null
      ) : (
        items.map(render)
      )}
    </View>
  );
}
