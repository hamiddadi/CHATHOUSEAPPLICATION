import React, { memo, useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import { formatDateTime } from '../../../../shared/utils/intl';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { AppNotification, NotificationKind } from '../../../../shared/types/domain';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useRemoveNotification,
} from '../../hooks/useNotifications';
import type { NotificationFilter } from '../../services/notificationService';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Notifications'>;

const TABS: readonly NotificationFilter[] = ['all', 'rooms', 'social', 'clubs'];

const ICON_FOR_KIND: Record<NotificationKind, React.ComponentProps<typeof MaterialIcons>['name']> =
  {
    follow: 'person-add',
    room_invite: 'mic',
    house_invite: 'home',
    room_starting: 'schedule',
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
    <MaterialIcons name="delete" size={22} color="white" />
    <Text className="text-xs text-white mt-xxs">{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 96,
    backgroundColor: colors.danger,
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
        accessibilityState={{ selected: notif.isRead }}
        className={
          notif.isRead
            ? 'flex-row items-start gap-md py-lg px-xxl'
            : 'flex-row items-start gap-md py-lg px-xxl bg-overlay-white-5'
        }
      >
        <View className="w-10 h-10 rounded-pill bg-surface-container items-center justify-center">
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
    accessibilityState={{ selected: active }}
    className={
      active
        ? 'px-lg py-sm rounded-pill bg-primary'
        : 'px-lg py-sm rounded-pill bg-overlay-white-5 border border-overlay-white-10'
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
  const { data, isLoading, isFetching, refetch } = useNotifications(filter);
  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const remove = useRemoveNotification();

  const unreadCount = (data ?? []).filter(n => !n.isRead).length;

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const handlePress = useCallback(
    (notif: AppNotification) => {
      if (!notif.isRead) markOne.mutate(notif.id);
      // Deep-link per kind — tap takes the user to the right place.
      if (notif.kind === 'follow' && notif.actor.id) {
        navigation.navigate('Profile', { userId: notif.actor.id });
      } else if (notif.kind === 'house_invite' && notif.houseId) {
        navigation.navigate('HouseDetail', { houseId: notif.houseId });
      } else if (
        (notif.kind === 'room_starting' ||
          notif.kind === 'room_invite' ||
          notif.kind === 'hand_accepted' ||
          notif.kind === 'rsvp_reminder') &&
        notif.roomId
      ) {
        navigation.navigate('Room', { roomId: notif.roomId });
      } else if (notif.kind === 'new_message' && notif.actor.id) {
        // DM deep-link: messages live outside the RoomStack (MessagesTab),
        // so we just land on the sender's profile for now; the user can
        // open the thread from there. A later polish pass can hop tabs.
        navigation.navigate('Profile', { userId: notif.actor.id });
      } else if (notif.kind === 'wave' && notif.actor.id) {
        navigation.navigate('Profile', { userId: notif.actor.id });
      }
    },
    [markOne, navigation],
  );

  const handleMarkAll = useCallback(() => markAll.mutate(), [markAll]);
  const handleDelete = useCallback((id: string) => remove.mutate(id), [remove]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8}>
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
            hitSlop={8}
            className="px-md py-xs rounded-pill bg-overlay-white-5"
          >
            <Text className="text-xs font-body-bold text-ink-muted">
              {t('notifications.markAllRead')}
            </Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row gap-sm px-xxl pb-md">
        {TABS.map(tab => (
          <TabPill
            key={tab}
            label={t(`notifications.tabs.${tab}`)}
            active={filter === tab}
            onPress={() => setFilter(tab)}
          />
        ))}
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('notifications.title')} />
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
          refreshing={isFetching}
          onRefresh={() => void refetch()}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};
