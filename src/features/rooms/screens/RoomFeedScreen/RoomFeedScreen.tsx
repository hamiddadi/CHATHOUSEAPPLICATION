import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '../../../../shared/components/Avatar';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { useAnimatedPress } from '../../../../shared/hooks/useAnimatedPress';
import { colors, layout, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { RoomSummary, UserSummary } from '../../../../shared/types/domain';
import { useRooms, roomKeys } from '../../hooks/useRooms';
import { roomService } from '../../services/roomService';
import { useHallwaySocket } from '../../hooks/useHallwaySocket';
import { formatScheduled } from '../../../../shared/utils/formatScheduled';
import {
  ExtAvailablePeopleStrip,
  ExtRecentlyPlayedStrip,
  ExtSuggestedFollowsStrip,
  ExtUpcomingForYouStrip,
  useExtWave,
} from '../../../extensions';
import { RoomFeedSkeleton } from './RoomFeedSkeleton';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'RoomFeed'>;

const FILTERS = ['All', 'Following', 'Clubs', 'Tech', 'Music', 'Business', 'Health'] as const;
type Filter = (typeof FILTERS)[number];

// i18n key + English default for each filter label (the value is also the
// backend param — see filterToParams — so the enum stays in English).
const FILTER_I18N: Record<Filter, { key: string; def: string }> = {
  All: { key: 'feed.filterAll', def: 'All' },
  Following: { key: 'feed.filterFollowing', def: 'Following' },
  Clubs: { key: 'feed.filterClubs', def: 'Clubs' },
  Tech: { key: 'feed.filterTech', def: 'Tech' },
  Music: { key: 'feed.filterMusic', def: 'Music' },
  Business: { key: 'feed.filterBusiness', def: 'Business' },
  Health: { key: 'feed.filterHealth', def: 'Health' },
};

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
  displayLabel: string;
  active: boolean;
  onPress: (f: Filter) => void;
}

const FilterPill: React.FC<FilterPillProps> = memo(({ label, displayLabel, active, onPress }) => {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(label), [label, onPress]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t('feed.filterA11y', 'Filter: {{label}}', { label: displayLabel })}
      accessibilityState={{ selected: active }}
      hitSlop={8}
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
        {displayLabel}
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
  const { t } = useTranslation();
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
                {t('feed.insideHouse', 'Inside {{houseName}}', { houseName: room.houseName })}
              </Text>
            )}
            {room.hasKnownSpeakers && (room.knownSpeakers?.length ?? 0) > 0 && (
              <View className="bg-primary/15 px-sm py-xxs rounded-xs">
                <Text className="text-xxs font-body-bold text-primary">
                  {t('feed.friendsInside', '👋 {{count}} ami·e·s', {
                    count: room.knownSpeakers?.length ?? 0,
                  })}
                </Text>
              </View>
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
                {t('feed.speakersCount', '{{count}} speakers', { count: room.speakersCount })}
              </Text>
            </View>
            <Text className="text-xs text-ink-muted">·</Text>
            <View className="flex-row items-center gap-xs">
              <Text className="text-xs">👂</Text>
              <Text className="text-xs font-body text-ink-muted">
                {t('feed.listenersCount', '{{count}} listeners', { count: room.listenersCount })}
              </Text>
            </View>
            {typeof room.participantCount === 'number' && (
              <>
                <Text className="text-xs text-ink-muted">·</Text>
                <View className="flex-row items-center gap-xs">
                  <Text className="text-xs">👥</Text>
                  <Text className="text-xs font-body text-ink-muted">
                    {t('feed.inRoom', '{{count}} in room', { count: room.participantCount })}
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
              <Text className="text-sm font-display text-primary-on-container">
                {t('feed.join', 'Join')}
              </Text>
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
  onActivity: () => void;
}

const HeaderIcon: React.FC<{
  name: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
  badge?: number;
}> = ({ name, label, onPress, badge }) => {
  const { t } = useTranslation();
  const hasBadge = typeof badge === 'number' && badge > 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Fold the unread count into the icon's own label so a screen reader
      // announces "Notifications, 3 unread" as a single, coherent element.
      accessibilityLabel={
        hasBadge
          ? `${label}, ${t('feed.unreadCount', '{{count}} unread', { count: badge })}`
          : label
      }
      hitSlop={8}
      className="w-10 h-10 items-center justify-center rounded-pill bg-overlay-white-5"
    >
      <MaterialIcons name={name} size={20} color={colors.text} />
      {hasBadge && (
        <View className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-pill bg-primary items-center justify-center">
          <Text className="text-xxs font-body-bold text-primary-on-container">
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      )}
    </Pressable>
  );
};

interface UpcomingRowProps {
  rooms: readonly RoomSummary[];
  onOpen: (roomId: string) => void;
}

const UpcomingRoomCard: React.FC<{ room: RoomSummary; onOpen: (roomId: string) => void }> = memo(
  ({ room, onOpen }) => {
    const { t } = useTranslation();
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
            {t('feed.insideHouse', 'Inside {{houseName}}', { houseName: room.houseName })}
          </Text>
        ) : null}
      </Pressable>
    );
  },
);
UpcomingRoomCard.displayName = 'UpcomingRoomCard';

const UpcomingRow: React.FC<UpcomingRowProps> = memo(({ rooms, onOpen }) => {
  const { t } = useTranslation();
  if (rooms.length === 0) return null;
  return (
    <View className="gap-md">
      <Text className="text-xl font-headline text-ink tracking-tight">
        {t('feed.upcoming', 'Upcoming')}
      </Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={rooms}
        keyExtractor={r => r.id}
        renderItem={({ item }) => <UpcomingRoomCard room={item} onOpen={onOpen} />}
        contentContainerStyle={styles.upcomingRow}
      />
    </View>
  );
});
UpcomingRow.displayName = 'UpcomingRow';

const Header: React.FC<HeaderProps> = memo(({ onSearch, onEvents, onActivity }) => {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center justify-between px-xxl py-lg">
      <View className="flex-row items-center gap-sm">
        <MaterialIcons name="graphic-eq" size={HEADER_ICON_SIZE} color={colors.primary} />
        <Text className="text-xxl font-display text-primary tracking-tighter">
          {t('common.appName', 'ChatHouse')}
        </Text>
      </View>
      <View className="flex-row items-center gap-sm">
        <HeaderIcon name="search" label={t('feed.exploreA11y', 'Explore')} onPress={onSearch} />
        <HeaderIcon name="event" label={t('feed.eventsA11y', 'Events')} onPress={onEvents} />
        {/* Activity bell — opens the extension ActivityFeed (waves, invites,
              follow-backs). */}
        <HeaderIcon
          name="notifications-none"
          label={t('feed.activityA11y', 'Activity')}
          onPress={onActivity}
        />
      </View>
    </View>
  );
});
Header.displayName = 'Header';

export const RoomFeedScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState<Filter>('All');
  const fab = useAnimatedPress({ scaleTo: 0.9 });
  const filterParams = useMemo(() => filterToParams(activeFilter), [activeFilter]);
  const {
    data: feedPages,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRooms(filterParams);
  const rooms = useMemo(() => feedPages?.pages.flat() ?? [], [feedPages]);
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Drive the pull-to-refresh spinner from a LOCAL flag, not react-query's
  // `isRefetching`. `isRefetching` also flips true on background/window-focus
  // refetches (and on the hallway-socket invalidations below), which made the
  // spinner appear spontaneously without any user gesture. This flag is set
  // only by the manual pull and cleared when the refetch settles.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const handlePullRefresh = useCallback(() => {
    setPullRefreshing(true);
    void refetch().finally(() => setPullRefreshing(false));
  }, [refetch]);

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

  const handleJoin = useCallback(
    (roomId: string) => navigation.navigate('Room', { roomId }),
    [navigation],
  );
  const handleStartRoom = useCallback(() => navigation.navigate('CreateRoom'), [navigation]);
  const handleSearch = useCallback(() => navigation.navigate('Explore'), [navigation]);
  const handleEvents = useCallback(() => navigation.navigate('Events'), [navigation]);
  const handleActivity = useCallback(() => navigation.navigate('ActivityFeed'), [navigation]);

  // Extension: wave to a user from the available-people strip
  const { wave } = useExtWave();
  const handleWaveUser = useCallback(
    (user: { id: string }) => {
      void wave(user.id);
    },
    [wave],
  );
  // Extension: open an upcoming event's room
  const handleUpcomingSelect = useCallback(
    (event: { id: string }) => navigation.navigate('Room', { roomId: event.id }),
    [navigation],
  );
  // Extension: resume a recently-played room (resume parity strip)
  const handleResumeSelect = useCallback(
    (roomId: string) => navigation.navigate('Room', { roomId }),
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: RoomSummary }) => <RoomCard room={item} onJoin={handleJoin} />,
    [handleJoin],
  );
  const keyExtractor = useCallback((item: RoomSummary) => item.id, []);
  const renderSeparator = useCallback(() => <View className="h-xl" />, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <Header onSearch={handleSearch} onEvents={handleEvents} onActivity={handleActivity} />

      {isLoading ? (
        <RoomFeedSkeleton />
      ) : isError ? (
        <EmptyState
          title={t('feed.couldNotLoad', "Couldn't load rooms")}
          description={t('feed.checkConnection', 'Check your connection and try again.')}
          actionLabel={t('common.retry', 'Retry')}
          onAction={handlePullRefresh}
        />
      ) : (
        <FlatList
          data={rooms}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          refreshing={pullRefreshing}
          onRefresh={handlePullRefresh}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.6}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View className="py-xl items-center">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null
          }
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
                    displayLabel={t(FILTER_I18N[f].key, FILTER_I18N[f].def)}
                    active={activeFilter === f}
                    onPress={setActiveFilter}
                  />
                ))}
              </View>
              <ExtAvailablePeopleStrip onWaveUser={handleWaveUser} />
              <ExtSuggestedFollowsStrip />
              <ExtUpcomingForYouStrip onSelect={handleUpcomingSelect} />
              <ExtRecentlyPlayedStrip onSelect={handleResumeSelect} />
              <UpcomingRow rooms={upcoming} onOpen={handleJoin} />
              <Text className="text-xl font-headline text-ink tracking-tight">
                {t('feed.liveNow', 'Live Now')}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title={t('feed.emptyTitle', 'No live rooms right now')}
              description={t(
                'feed.emptyBody',
                'Be the first — start a room and get the room talking.',
              )}
              actionLabel={t('feed.emptyCta', 'Start a room')}
              onAction={handleStartRoom}
            />
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
          accessibilityLabel={t('feed.startNewA11y', 'Start a new room')}
          accessibilityHint={t('feed.startNewHint', 'Opens the room creation modal')}
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
    backgroundColor: colors.overlayWhite15,
    marginHorizontal: spacing.sm,
    marginTop: (SPEAKER_AVATAR_SIZE - 20) / 2,
  },
  upcomingRow: { gap: spacing.md, paddingRight: spacing.md },
  upcomingCard: { width: 220 },
});
