import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { activityApi, type ActivityItem } from '../api/activityApi';
import { useExtSocketAliases } from '../hooks/useExtSocketAliases';
import { colors } from '../../../shared/constants/theme';

type Filter = 'all' | 'rooms' | 'social' | 'clubs';
const getFilters = (t: TFunction): { value: Filter; label: string }[] => [
  { value: 'all', label: t('extensions.activity.filters.all', 'All') },
  { value: 'rooms', label: t('extensions.activity.filters.rooms', 'Rooms') },
  { value: 'social', label: t('extensions.activity.filters.social', 'Social') },
  { value: 'clubs', label: t('extensions.activity.filters.clubs', 'Clubs') },
];

// Cap the in-memory feed so a long-lived session with a busy realtime stream
// doesn't grow `items` (and the FlatList window) without bound.
const MAX_ITEMS = 200;

// Prefix marking a synthetic live (socket-driven) entry that the server hasn't
// persisted yet. Shared by the prepend handlers and the merge/dedupe logic so
// the contract lives in one place.
const LIVE_PREFIX = 'live-';
const isLiveId = (id: string): boolean => id.startsWith(LIVE_PREFIX);

/** Prepend a live socket entry, capping the list length. */
const prependCapped = (prev: ActivityItem[], next: ActivityItem): ActivityItem[] =>
  [next, ...prev].slice(0, MAX_ITEMS);

/**
 * Memoized feed row. Extracted + `React.memo`'d so that a state change driven
 * by a single incoming socket event doesn't force every row to re-render.
 */
const ActivityRow = memo<{ item: ActivityItem; onTap: (item: ActivityItem) => void }>(
  ({ item, onTap }) => (
    <Pressable
      style={[styles.row, !item.isRead && styles.rowUnread]}
      onPress={() => onTap(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title} — ${item.body}`}
    >
      {item.actor?.avatarUrl ? (
        <Image source={{ uri: item.actor.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarText}>
            {(item.actor?.displayName ?? item.title).slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.itemBody} numberOfLines={2}>
          {item.body}
        </Text>
        <Text style={styles.when}>{formatRelative(item.createdAt)}</Text>
      </View>
      {!item.isRead ? <View style={styles.dot} /> : null}
    </Pressable>
  ),
);
ActivityRow.displayName = 'ActivityRow';

/**
 * Activity feed (Module 12.7 / NOTIF-014). Lists the user's notifications
 * with tab filters and live-prepends entries arriving via the V8 alias
 * events (`room_started_by_following`, `new_follower`, `join_request`,
 * `ping_user`).
 *
 * Reuses the existing `/notifications` REST surface; pure additive screen.
 */
export const ExtActivityFeedScreen: React.FC<{ onTapItem?: (item: ActivityItem) => void }> = ({
  onTapItem,
}) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Monotonic request id: tab-switching fires overlapping fetches with no
  // cancellation, so a slow earlier response could overwrite the current tab.
  // Only the most recent request is allowed to commit.
  const reqIdRef = useRef(0);

  const fetchItems = useCallback(async () => {
    const myId = ++reqIdRef.current;
    try {
      const next = await activityApi.list(filter);
      if (reqIdRef.current !== myId) return; // a newer filter request superseded this one
      // Merge: server entries win, but keep live socket entries the server
      // hasn't persisted yet — deduping by targetType+targetId so a live entry
      // and its later server counterpart don't both appear.
      setItems(prev => {
        const serverKeys = new Set(next.map(i => `${i.targetType}:${i.targetId}`));
        const survivingLive = prev.filter(
          i => isLiveId(i.id) && !serverKeys.has(`${i.targetType}:${i.targetId}`),
        );
        return [...survivingLive, ...next].slice(0, MAX_ITEMS);
      });
    } catch {
      /* keep stale list */
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    void fetchItems().finally(() => setLoading(false));
  }, [fetchItems]);

  // Live prepend on alias broadcasts
  useExtSocketAliases({
    room_started_by_following: payload => {
      if (filter !== 'all' && filter !== 'rooms') return; // ROOM_STARTED ∈ rooms
      setItems(prev =>
        prependCapped(prev, {
          id: `${LIVE_PREFIX}${payload.roomId}-${Date.now()}`,
          type: 'ROOM_STARTED',
          title: payload.hostName ?? 'Someone you follow',
          body: `started "${payload.title}"`,
          data: { roomId: payload.roomId },
          targetId: payload.roomId,
          targetType: 'room',
          actor: {
            id: payload.hostId,
            username: null,
            displayName: payload.hostName,
            avatarUrl: null,
          },
          isRead: false,
          createdAt: new Date().toISOString(),
        }),
      );
    },
    join_request: payload => {
      if (filter !== 'all' && filter !== 'clubs') return; // CLUB_INVITE ∈ clubs
      setItems(prev =>
        prependCapped(prev, {
          id: `${LIVE_PREFIX}jr-${payload.clubId}-${Date.now()}`,
          type: 'CLUB_INVITE',
          title: 'Join request',
          body: payload.message ?? 'New request to join',
          data: { clubId: payload.clubId, requesterId: payload.requesterId },
          targetId: payload.clubId,
          targetType: 'club',
          actor: null,
          isRead: false,
          createdAt: new Date().toISOString(),
        }),
      );
    },
    ping_user: payload => {
      if (filter !== 'all' && filter !== 'social') return; // WAVE ∈ social
      setItems(prev =>
        prependCapped(prev, {
          id: `${LIVE_PREFIX}ping-${payload.fromUserId}-${Date.now()}`,
          type: 'WAVE',
          title: 'Wave received',
          body: 'Someone is waving at you',
          data: { roomId: payload.roomId, kind: payload.type },
          targetId: payload.fromUserId,
          targetType: 'user',
          actor: null,
          isRead: false,
          createdAt: new Date().toISOString(),
        }),
      );
    },
  });

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await fetchItems();
    setRefreshing(false);
  }, [fetchItems]);

  const handleTap = useCallback(
    (item: ActivityItem): void => {
      if (!isLiveId(item.id)) {
        void activityApi.markRead(item.id).catch(() => undefined);
      }
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, isRead: true } : i)));
      onTapItem?.(item);
    },
    [onTapItem],
  );

  const renderItem = useCallback(
    ({ item }: { item: ActivityItem }) => <ActivityRow item={item} onTap={handleTap} />,
    [handleTap],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('extensions.activity.title', 'Activity')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            'extensions.activity.markAllA11y',
            'Mark all notifications as read',
          )}
          onPress={() => {
            setItems(prev => prev.map(i => ({ ...i, isRead: true })));
            void activityApi.markAllRead().catch(() => undefined);
          }}
        >
          <Text style={styles.markAll}>{t('extensions.activity.markAll', 'Mark all read')}</Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {getFilters(t).map(f => (
          <Pressable
            key={f.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f.value }}
            accessibilityLabel={`${t('extensions.activity.filterA11y', 'Filter')}: ${f.label}`}
            onPress={() => setFilter(f.value)}
            style={[styles.tab, filter === f.value && styles.tabActive]}
          >
            <Text style={[styles.tabText, filter === f.value && styles.tabTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          refreshing={refreshing}
          onRefresh={onRefresh}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {t('extensions.activity.empty', 'No activity yet.')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const formatRelative = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  markAll: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.surfaceHigh,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.onPrimary },
  loader: { marginTop: 24 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    gap: 12,
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
  },
  rowUnread: { backgroundColor: colors.overlayWhite5 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textMuted, fontWeight: '700' },
  body: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  itemBody: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  when: { fontSize: 11, color: colors.textDim, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  empty: { marginTop: 60, alignItems: 'center' },
  emptyText: { color: colors.textDim },
});
