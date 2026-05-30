import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '../../../../shared/components/Avatar';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { useAnimatedPress } from '../../../../shared/hooks/useAnimatedPress';
import { colors, layout, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { RoomSummary, UserSummary } from '../../../../shared/types/domain';
import { useRooms, roomKeys } from '../../hooks/useRooms';
import { roomService } from '../../services/roomService';
import { useHallwaySocket } from '../../hooks/useHallwaySocket';
import { useUnreadNotificationCount } from '../../../notifications/hooks/useNotifications';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'RoomFeed'>;

const FILTERS = ['All', 'Following', 'Clubs', 'Tech', 'Music', 'Business', 'Health'] as const;
type Filter = (typeof FILTERS)[number];

// Map UI labels to the backend's topic / following / clubs params. `All` is
// the no-filter case (sends nothing), `Following` flips the following flag,
// `Clubs` restricts to club-attached rooms, the rest become a `topic` query
// string.
const filterToParams = (f: Filter): { topic?: string; following?: boolean; clubs?: boolean } => {
  if (f === 'All') return {};
  if (f === 'Following') return { following: true };
  if (f === 'Clubs') return { clubs: true };
  return { topic: f.toLowerCase() };
};

const SPEAKER_AVATAR_SIZE = 36;
const LISTENER_AVATAR_SIZE = 28;
const AVATAR_GAP = 6;
const FAB_BOTTOM_OFFSET = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.xl;
const HEADER_ICON_SIZE = 24;
const FAB_ICON_SIZE = 28;

const CATEGORY_COLOR_CLASS: Record<string, string> = {
  tech: 'text-primary',
  design: 'text-secondary',
  crypto: 'text-warning',
  ai: 'text-accent',
  music: 'text-secondary',
  business: 'text-primary',
  health: 'text-accent',
};

interface FilterPillProps {
  label: Filter;
  active: boolean;
  onPress: (f: Filter) => void;
}

const FilterPill: React.FC<FilterPillProps> = memo(({ label, active, onPress }) => {
  const handlePress = useCallback(() => onPress(label), [label, onPress]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Filter: ${label}`}
      accessibilityState={{ selected: active }}
      className={
        active
          ? 'px-xl py-sm rounded-pill bg-primary'
          : 'px-xl py-sm rounded-pill bg-glass border border-overlay-white-10'
      }
    >
      <Text
        className={
          active
            ? 'text-sm font-body-bold text-primary-on-container'
            : 'text-sm font-body-bold text-ink-muted'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
});
FilterPill.displayName = 'FilterPill';

interface ParticipantsRowProps {
  speakers: readonly UserSummary[];
  listeners: readonly UserSummary[];
}

const ParticipantsRow: React.FC<ParticipantsRowProps> = memo(({ speakers, listeners }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.participantsRow}
  >
    {speakers.map(s => (
      <View key={`sp-${s.id}`} style={[styles.avatarSlot, styles.speakerSlot]}>
        <Avatar
          uri={s.avatarUrl ?? undefined}
          name={s.displayName}
          sizeValue={SPEAKER_AVATAR_SIZE}
          shape="circle"
          status="speaking"
        />
        <Text
          className="text-xxs font-body-medium text-ink-muted mt-xxs text-center"
          numberOfLines={1}
        >
          {s.displayName}
        </Text>
      </View>
    ))}
    {speakers.length > 0 && listeners.length > 0 && <View style={styles.participantsDivider} />}
    {listeners.map(l => (
      <View key={`ls-${l.id}`} style={styles.avatarSlot}>
        <Avatar
          uri={l.avatarUrl ?? undefined}
          name={l.displayName}
          sizeValue={LISTENER_AVATAR_SIZE}
          shape="circle"
        />
      </View>
    ))}
  </ScrollView>
));
ParticipantsRow.displayName = 'ParticipantsRow';

interface RoomCardProps {
  room: RoomSummary;
  onJoin: (roomId: string) => void;
}

const RoomCard: React.FC<RoomCardProps> = memo(({ room, onJoin }) => {
  const { animatedStyle, onPressIn, onPressOut } = useAnimatedPress({ scaleTo: 0.96 });
  const handleJoin = useCallback(() => onJoin(room.id), [onJoin, room.id]);
  const colorClass = CATEGORY_COLOR_CLASS[room.category] ?? 'text-primary';

  return (
    <View className="rounded-md bg-overlay-white-5 border border-overlay-white-10 overflow-hidden">
      <View className="p-xxl gap-lg">
        <View className="gap-xs">
          <View className="flex-row items-center gap-sm">
            <View className="bg-surface-highest px-sm py-xxs rounded-xs">
              <Text className={`text-xxs font-body-bold uppercase tracking-tighter ${colorClass}`}>
                {room.categoryEmoji} {room.category}
              </Text>
            </View>
            {room.houseName && (
              <Text className="text-xs font-body-medium text-ink-muted" numberOfLines={1}>
                Inside {room.houseName}
              </Text>
            )}
          </View>
          <Text className="text-xl font-display text-white leading-snug">{room.title}</Text>
        </View>

        <ParticipantsRow speakers={room.topSpeakers} listeners={room.topListeners} />

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-sm flex-wrap flex-1">
            <View className="flex-row items-center gap-xs">
              <Text className="text-xs">🎙️</Text>
              <Text className="text-xs font-body-medium text-ink-dim">
                {room.speakersCount} speakers
              </Text>
            </View>
            <Text className="text-xs text-ink-dim opacity-50">·</Text>
            <View className="flex-row items-center gap-xs">
              <Text className="text-xs">👂</Text>
              <Text className="text-xs font-body text-ink-muted">
                {room.listenersCount} listeners
              </Text>
            </View>
            {typeof room.participantCount === 'number' && (
              <>
                <Text className="text-xs text-ink-dim opacity-50">·</Text>
                <View className="flex-row items-center gap-xs">
                  <Text className="text-xs">👥</Text>
                  <Text className="text-xs font-body text-ink-muted">
                    {room.participantCount} in room
                  </Text>
                </View>
              </>
            )}
          </View>

          <Animated.View style={animatedStyle}>
            <Pressable
              onPress={handleJoin}
              onPressIn={onPressIn}
              onPressOut={onPressOut}
              accessibilityRole="button"
              accessibilityLabel={`Join room: ${room.title}`}
              className="bg-primary rounded-pill px-xxl py-sm items-center justify-center ml-md"
            >
              <Text className="text-sm font-display text-primary-on-container">Join</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
});
RoomCard.displayName = 'RoomCard';

interface HeaderProps {
  onSearch: () => void;
  onEvents: () => void;
  onNotifications: () => void;
  unreadCount: number;
}

const HeaderIcon: React.FC<{
  name: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
  badge?: number;
}> = ({ name, label, onPress, badge }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    hitSlop={8}
    className="w-10 h-10 items-center justify-center rounded-pill bg-overlay-white-5"
  >
    <MaterialIcons name={name} size={20} color={colors.text} />
    {typeof badge === 'number' && badge > 0 && (
      <View
        className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-pill bg-primary items-center justify-center"
        accessibilityLabel={`${badge} unread`}
      >
        <Text className="text-xxs font-body-bold text-primary-on-container">
          {badge > 99 ? '99+' : badge}
        </Text>
      </View>
    )}
  </Pressable>
);

// Short, locale-aware "when" label for a scheduled room. Falls back to a
// plain date for events further out than a week.
const formatScheduled = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffMin = Math.round((ts - Date.now()) / 60_000);
  if (diffMin <= 0) return 'Starting soon';
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay <= 7) return `in ${diffDay}d`;
  return new Date(ts).toLocaleDateString();
};

interface UpcomingRowProps {
  rooms: readonly RoomSummary[];
  onOpen: (roomId: string) => void;
}

const UpcomingRoomCard: React.FC<{ room: RoomSummary; onOpen: (roomId: string) => void }> = memo(
  ({ room, onOpen }) => {
    const handlePress = useCallback(() => onOpen(room.id), [onOpen, room.id]);
    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`Upcoming room: ${room.title}`}
        style={styles.upcomingCard}
        className="rounded-md bg-overlay-white-5 border border-overlay-white-10 p-lg gap-xs"
      >
        <View className="flex-row items-center gap-xs">
          <MaterialIcons name="schedule" size={14} color={colors.primary} />
          <Text className="text-xxs font-body-bold text-primary" numberOfLines={1}>
            {formatScheduled(room.scheduledFor)}
          </Text>
        </View>
        <Text className="text-sm font-display text-white leading-snug" numberOfLines={2}>
          {room.title}
        </Text>
        {room.houseName ? (
          <Text className="text-xxs font-body-medium text-ink-muted" numberOfLines={1}>
            Inside {room.houseName}
          </Text>
        ) : null}
      </Pressable>
    );
  },
);
UpcomingRoomCard.displayName = 'UpcomingRoomCard';

const UpcomingRow: React.FC<UpcomingRowProps> = memo(({ rooms, onOpen }) => {
  if (rooms.length === 0) return null;
  return (
    <View className="gap-md">
      <Text className="text-xl font-headline text-ink tracking-tight">Upcoming</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.upcomingRow}
      >
        {rooms.map(r => (
          <UpcomingRoomCard key={r.id} room={r} onOpen={onOpen} />
        ))}
      </ScrollView>
    </View>
  );
});
UpcomingRow.displayName = 'UpcomingRow';

const Header: React.FC<HeaderProps> = memo(
  ({ onSearch, onEvents, onNotifications, unreadCount }) => (
    <View className="flex-row items-center justify-between px-xxl py-lg">
      <View className="flex-row items-center gap-sm">
        <MaterialIcons name="graphic-eq" size={HEADER_ICON_SIZE} color={colors.primary} />
        <Text className="text-xxl font-display text-primary tracking-tighter">Chathouse</Text>
      </View>
      <View className="flex-row items-center gap-sm">
        <HeaderIcon name="search" label="Explore" onPress={onSearch} />
        <HeaderIcon name="event" label="Events" onPress={onEvents} />
        <HeaderIcon
          name="notifications"
          label="Notifications"
          onPress={onNotifications}
          badge={unreadCount}
        />
      </View>
    </View>
  ),
);
Header.displayName = 'Header';

export const RoomFeedScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState<Filter>('All');
  const fab = useAnimatedPress({ scaleTo: 0.9 });
  const filterParams = useMemo(() => filterToParams(activeFilter), [activeFilter]);
  const { data: rooms, isLoading, isError, refetch } = useRooms(filterParams);

  // Scheduled rooms shown as a horizontal "Upcoming" band above Live Now.
  // Backend's `upcoming` filter already orders by scheduledFor ascending.
  const { data: upcoming = [] } = useQuery<RoomSummary[]>({
    queryKey: [...roomKeys.list(), { filter: 'upcoming' }],
    queryFn: () => roomService.list({ filter: 'upcoming' }),
    staleTime: 60_000,
  });

  // Subscribe to live hallway broadcasts — new/ended rooms invalidate
  // the scored feed so ranking stays fresh without manual refreshes.
  useHallwaySocket();
  const { data: unreadCount = 0 } = useUnreadNotificationCount();

  const handleJoin = useCallback(
    (roomId: string) => navigation.navigate('Room', { roomId }),
    [navigation],
  );
  const handleStartRoom = useCallback(() => navigation.navigate('CreateRoom'), [navigation]);
  const handleSearch = useCallback(() => navigation.navigate('Explore'), [navigation]);
  const handleEvents = useCallback(() => navigation.navigate('Events'), [navigation]);
  const handleNotifications = useCallback(() => navigation.navigate('Notifications'), [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: RoomSummary }) => <RoomCard room={item} onJoin={handleJoin} />,
    [handleJoin],
  );
  const keyExtractor = useCallback((item: RoomSummary) => item.id, []);
  const renderSeparator = useCallback(() => <View className="h-xl" />, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <Header
        onSearch={handleSearch}
        onEvents={handleEvents}
        onNotifications={handleNotifications}
        unreadCount={unreadCount}
      />

      {isLoading ? (
        <Loader fullscreen accessibilityLabel="Loading live rooms" />
      ) : isError ? (
        <EmptyState
          title="Couldn't load rooms"
          description="Check your connection and try again."
        />
      ) : (
        <FlatList
          data={rooms ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          refreshing={isLoading}
          onRefresh={refetch}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + FAB_BOTTOM_OFFSET + spacing.giant },
          ]}
          ListHeaderComponent={
            <View className="gap-xxl mb-lg">
              <View className="flex-row gap-md flex-wrap">
                {FILTERS.map(f => (
                  <FilterPill
                    key={f}
                    label={f}
                    active={activeFilter === f}
                    onPress={setActiveFilter}
                  />
                ))}
              </View>
              <UpcomingRow rooms={upcoming} onOpen={handleJoin} />
              <Text className="text-xl font-headline text-ink tracking-tight">Live Now</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <Animated.View
        // `pointerEvents="box-none"` makes the animated wrapper transparent
        // to taps that don't land on its children — without it, the empty
        // pixels around the FAB intercept scroll/swipe gestures meant for
        // the FlatList underneath.
        pointerEvents="box-none"
        style={[fab.animatedStyle, styles.fab, { bottom: insets.bottom + FAB_BOTTOM_OFFSET }]}
      >
        <Pressable
          onPress={handleStartRoom}
          onPressIn={fab.onPressIn}
          onPressOut={fab.onPressOut}
          accessibilityRole="button"
          accessibilityLabel="Start a new room"
          accessibilityHint="Opens the room creation modal"
          className="w-16 h-16 rounded-pill bg-primary items-center justify-center shadow-glow-primary"
        >
          <MaterialIcons name="add" size={FAB_ICON_SIZE} color={colors.onPrimary} />
        </Pressable>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: spacing.xxl },
  fab: { position: 'absolute', right: spacing.xxl },
  participantsRow: { alignItems: 'flex-start' },
  avatarSlot: { marginRight: AVATAR_GAP },
  // Speaker slots reserve a little extra width so the name label below the
  // avatar can render without truncating short display names.
  speakerSlot: { width: SPEAKER_AVATAR_SIZE + 16, alignItems: 'center' },
  participantsDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginHorizontal: spacing.sm,
    marginTop: (SPEAKER_AVATAR_SIZE - 20) / 2,
  },
  upcomingRow: { gap: spacing.md, paddingRight: spacing.md },
  upcomingCard: { width: 220 },
});
