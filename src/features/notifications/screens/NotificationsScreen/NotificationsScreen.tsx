import React, { memo, useCallback, useState } from 'react';
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
import { Swipeable } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, palette, spacing } from '../../../../shared/constants/theme';
import { formatDateTime } from '../../../../shared/utils/intl';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { AppNotification, NotificationKind } from '../../../../shared/types/domain';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useRemoveNotification,
  useUnreadNotificationCount,
} from '../../hooks/useNotifications';
import type { NotificationFilter } from '../../services/notificationService';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Notifications'>;

const TABS: readonly NotificationFilter[] = ['all', 'rooms', 'social', 'clubs'];

const ICON_FOR_KIND: Record<NotificationKind, React.ComponentProps<typeof MaterialIcons>['name']> =
  {
    follow: 'person-add',
    follow_request: 'person-add-alt',
    room_invite: 'mic',
    house_invite: 'home',
    room_starting: 'schedule',
    room_canceled: 'event-busy',
    room_ended_by_admin: 'gavel',
    mention: 'alternate-email',
    wave: 'waving-hand',
    hand_accepted: 'pan-tool',
    rsvp_reminder: 'event-available',
    new_message: 'chat-bubble',
  };

interface RowProps {
  notif: AppNotification;
  onPress: (notif: AppNotification) => void;
  onDelete: (id: string) => void;
}

const RightActions: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={styles.swipeAction}
  >
    <MaterialIcons name="delete" size={22} color={palette.onError} />
    <Text className="text-xs text-on-danger mt-xxs">{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 96,
    backgroundColor: colors.danger,
  },
  tabs: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  tabScroller: {
    flexGrow: 0,
    flexShrink: 0,
  },
});

const NotificationRow: React.FC<RowProps> = memo(({ notif, onPress, onDelete }) => {
  const { t } = useTranslation();
  const iconName = ICON_FOR_KIND[notif.kind] ?? 'notifications';
  return (
    <Swipeable
      renderRightActions={() => (
        <RightActions label={t('notifications.delete')} onPress={() => onDelete(notif.id)} />
      )}
      overshootRight={false}
    >
      <Pressable
        onPress={() => onPress(notif)}
        accessibilityRole="button"
        accessibilityLabel={t(
          notif.isRead ? 'notifications.itemReadA11y' : 'notifications.itemUnreadA11y',
          notif.isRead ? 'Read notification: {{message}}' : 'Unread notification: {{message}}',
          { message: notif.message },
        )}
        className={
          notif.isRead
            ? 'flex-row items-start gap-md py-lg px-xxl'
            : 'flex-row items-start gap-md py-lg px-xxl bg-overlay-white-5'
        }
      >
        <View className="w-10 h-10 rounded-pill bg-surface-alt items-center justify-center">
          <MaterialIcons name={iconName} size={18} color={colors.primary} />
        </View>
        <View className="flex-1 gap-xxs">
          <Text className="text-sm text-ink" numberOfLines={2}>
            {notif.message}
          </Text>
          <Text className="text-xs text-ink-dim">{formatDateTime(notif.createdAt)}</Text>
        </View>
        {!notif.isRead && <View className="w-2 h-2 rounded-pill bg-primary mt-xs" />}
      </Pressable>
    </Swipeable>
  );
});
NotificationRow.displayName = 'NotificationRow';

const TabPill: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
}> = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected: active }}
    className={
      active
        ? 'px-lg py-sm min-h-[44px] items-center justify-center rounded-pill bg-primary'
        : 'px-lg py-sm min-h-[44px] items-center justify-center rounded-pill bg-overlay-white-5 border border-overlay-white-10'
    }
  >
    <Text
      className={
        active
          ? 'text-xs font-body-bold text-primary-on-container'
          : 'text-xs font-body-bold text-ink-muted'
      }
    >
      {label}
    </Text>
  </Pressable>
);

export const NotificationsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [filter, setFilter] = useState<NotificationFilter>('all');
  const {
    data,
    isLoading,
    isError,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useNotifications(filter);
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const remove = useRemoveNotification();
  const unreadQuery = useUnreadNotificationCount();

  // Loaded pages may cover only the newest 50 rows. Prefer the exact backend
  // count; the current page remains a resilient fallback while it is loading.
  const unreadCount = unreadQuery.data ?? (data ?? []).filter(n => !n.isRead).length;

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const handlePress = useCallback(
    (notif: AppNotification) => {
      if (!notif.isRead) markOne.mutate(notif.id);
      // Deep-link per kind — tap takes the user to the right place.
      if (notif.kind === 'follow_request') {
        navigation.navigate('FollowRequests');
      } else if (notif.kind === 'follow' && notif.actor.id) {
        navigation.navigate('Profile', { userId: notif.actor.id });
      } else if (notif.kind === 'house_invite' && notif.houseId) {
        // Route to the dedicated invitation screen (Accept/Decline) rather than
        // straight to HouseDetail, which is a dead-end for PRIVATE houses.
        navigation.navigate('HouseInvitation', { houseId: notif.houseId });
      } else if (notif.kind === 'new_message' && notif.actor.id) {
        // DM deep-link: messages live outside the RoomStack (MessagesTab), so
        // hop through the root 'Main' navigator to the thread (conversationId
        // === peer userId). Same cross-tab pattern as MapsScreen/RoomScreen.
        const isGroup = notif.conversationType === 'group' && notif.conversationId;
        (navigation as unknown as { navigate: (name: string, params: object) => void }).navigate(
          'Main',
          isGroup
            ? {
                screen: 'MessagesTab',
                params: {
                  screen: 'GroupChat',
                  params: { conversationId: notif.conversationId },
                },
              }
            : {
                screen: 'MessagesTab',
                params: { screen: 'ChatDetail', params: { conversationId: notif.actor.id } },
              },
        );
      } else if (notif.roomId) {
        // Any room-scoped notification (room_starting / room_invite /
        // hand_accepted / rsvp_reminder, and mention / SPEAKER_REQUEST which the
        // service maps to `mention`) carries a roomId → open the Room.
        navigation.navigate('Room', { roomId: notif.roomId });
      } else if (notif.actor.id) {
        // Fallback for actor-centric kinds (wave, mention without a roomId) →
        // the actor's profile.
        navigation.navigate('Profile', { userId: notif.actor.id });
      }
    },
    [markOne, navigation],
  );

  const handleMarkAll = useCallback(() => markAll.mutate(), [markAll]);
  const openFollowRequests = useCallback(() => navigation.navigate('FollowRequests'), [navigation]);
  const handleDelete = useCallback((id: string) => remove.mutate(id), [remove]);
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const renderFooter = useCallback(
    () =>
      isFetchingNextPage ? (
        <View className="py-lg items-center">
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel={t('common.loadingMore', 'Loading more')}
          />
        </View>
      ) : null,
    [isFetchingNextPage, t],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          hitSlop={12}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xl font-display text-ink">{t('notifications.title')}</Text>
          {unreadCount > 0 && (
            <Text className="text-xs text-ink-muted">
              {t('notifications.unread', { count: unreadCount })}
            </Text>
          )}
        </View>
        {unreadCount > 0 && (
          <Pressable
            onPress={handleMarkAll}
            accessibilityRole="button"
            accessibilityLabel={t('notifications.markAllRead')}
            hitSlop={12}
            className="px-md py-xs rounded-pill bg-overlay-white-5"
          >
            <Text className="text-xs font-body-bold text-ink-muted">
              {t('notifications.markAllRead')}
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        style={styles.tabScroller}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map(tab => (
          <TabPill
            key={tab}
            label={t(`notifications.tabs.${tab}`)}
            active={filter === tab}
            onPress={() => setFilter(tab)}
          />
        ))}
      </ScrollView>

      <Pressable
        onPress={openFollowRequests}
        accessibilityRole="button"
        accessibilityLabel={t('notifications.followRequests.openA11y')}
        accessibilityHint={t('notifications.followRequests.openHint')}
        className="mx-xxl mb-md px-lg py-md rounded-md bg-overlay-white-5 flex-row items-center gap-md"
      >
        <MaterialIcons name="person-add-alt" size={20} color={colors.primary} />
        <Text className="text-sm font-body-bold text-ink flex-1">
          {t('notifications.followRequests.open')}
        </Text>
        <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
      </Pressable>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('notifications.title')} />
      ) : isError ? (
        <EmptyState
          title={t('notifications.errorTitle', "Couldn't load notifications")}
          description={t('notifications.errorBody', 'Check your connection and try again.')}
          actionLabel={t('common.retry', 'Retry')}
          onAction={() => void refetch()}
        />
      ) : (data ?? []).length === 0 ? (
        <EmptyState title={t('notifications.empty')} description="" />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={n => n.id}
          renderItem={({ item }) => (
            <NotificationRow notif={item} onPress={handlePress} onDelete={handleDelete} />
          )}
          ItemSeparatorComponent={() => <View className="h-px bg-overlay-white-5" />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.huge }}
          refreshing={isRefetching && !isFetchingNextPage}
          onRefresh={() => void refetch()}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          ListFooterComponent={renderFooter}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};
