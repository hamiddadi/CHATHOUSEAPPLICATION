import React, { memo, useCallback, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { useDebouncedValue } from '../../../../shared/hooks/useDebouncedValue';
import { useExplore, useSearch } from '../../hooks/useSearch';
import type { SearchRoomHit } from '../../services/searchService';
import type { ExploreClubHit, ExploreUserHit } from '../../services/exploreService';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Explore'>;

/**
 * One search bar + trending feed. While the user types we switch to
 * the search results view; empty query shows the explore feed. A
 * lightweight debounce keeps keystrokes cheap even though the backend
 * trigram index makes this cheap too.
 */
const DEBOUNCE_MS = 200;

const RoomRow: React.FC<{ room: SearchRoomHit; onPress: (id: string) => void }> = memo(
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
type ClubRowData =
  | ExploreClubHit
  | (Omit<ExploreClubHit, 'liveRoomsCount'> & { liveRoomsCount?: number });
type UserRowData =
  | ExploreUserHit
  | (Omit<ExploreUserHit, 'followersCount'> & { followersCount?: number });

const ClubRow: React.FC<{ club: ClubRowData; onPress: (id: string) => void }> = memo(
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

const UserRow: React.FC<{ user: UserRowData; onPress: (id: string) => void }> = memo(
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

export const ExploreScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebouncedValue(rawQuery.trim(), DEBOUNCE_MS);

  const explore = useExplore();
  const search = useSearch(debouncedQuery);

  const goRoom = useCallback(
    (roomId: string) => navigation.navigate('Room', { roomId }),
    [navigation],
  );
  const goClub = useCallback(
    (houseId: string) => navigation.navigate('HouseDetail', { houseId }),
    [navigation],
  );
  const goUser = useCallback(
    (userId: string) => navigation.navigate('Profile', { userId }),
    [navigation],
  );
  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const isSearching = debouncedQuery.length > 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-xl font-display text-ink flex-1">{t('explore.title')}</Text>
      </View>

      <View className="px-xxl pb-md">
        <Input
          placeholder={t('explore.searchPlaceholder')}
          value={rawQuery}
          onChangeText={setRawQuery}
          autoCorrect={false}
          autoCapitalize="none"
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
        />
      </View>

      {isSearching ? (
        search.isLoading ? (
          <Loader fullscreen accessibilityLabel={t('explore.searchResults')} />
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingBottom: insets.bottom + spacing.huge,
              paddingHorizontal: spacing.xxl,
            }}
          >
            {(search.data?.users.length ?? 0) +
              (search.data?.clubs.length ?? 0) +
              (search.data?.rooms.length ?? 0) ===
            0 ? (
              <EmptyState title={t('explore.searchEmpty', { q: debouncedQuery })} description="" />
            ) : (
              <View className="gap-xxl">
                <Section
                  title={t('explore.peopleToFollow')}
                  items={search.data?.users}
                  render={u => <UserRow key={u.id} user={u} onPress={goUser} />}
                />
                <Section
                  title={t('explore.popularClubs')}
                  items={search.data?.clubs}
                  render={c => <ClubRow key={c.id} club={c} onPress={goClub} />}
                />
                <Section
                  title={t('explore.trendingRooms')}
                  items={search.data?.rooms}
                  render={r => <RoomRow key={r.id} room={r} onPress={goRoom} />}
                />
              </View>
            )}
          </ScrollView>
        )
      ) : explore.isLoading ? (
        <Loader fullscreen accessibilityLabel={t('explore.title')} />
      ) : (
        <FlatList
          data={[0] as const}
          keyExtractor={() => 'sections'}
          contentContainerStyle={{
            paddingBottom: insets.bottom + spacing.huge,
            paddingHorizontal: spacing.xxl,
          }}
          renderItem={() => (
            <View className="gap-xxl">
              <Section
                title={t('explore.trendingRooms')}
                empty={t('explore.emptyRooms')}
                items={explore.data?.rooms}
                render={r => <RoomRow key={r.id} room={r} onPress={goRoom} />}
              />
              <Section
                title={t('explore.popularClubs')}
                empty={t('explore.emptyClubs')}
                items={explore.data?.clubs}
                render={c => <ClubRow key={c.id} club={c} onPress={goClub} />}
              />
              <Section
                title={t('explore.peopleToFollow')}
                empty={t('explore.emptyUsers')}
                items={explore.data?.users}
                render={u => <UserRow key={u.id} user={u} onPress={goUser} />}
              />
            </View>
          )}
          refreshing={explore.isFetching}
          onRefresh={() => void explore.refetch()}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

interface SectionProps<T> {
  title: string;
  empty?: string;
  items?: readonly T[];
  render: (item: T) => React.ReactNode;
}

function Section<T>({ title, empty, items, render }: SectionProps<T>) {
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
