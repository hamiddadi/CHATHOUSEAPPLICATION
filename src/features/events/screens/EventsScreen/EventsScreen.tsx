import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { useCancelRsvp, useMyEvents, useRsvp, useUpcomingEvents } from '../../hooks/useEvents';
import type { ScheduledEvent } from '../../services/eventService';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Events'>;

type Tab = 'upcoming' | 'mine';

const formatRelative = (iso: string, t: TFunction): string => {
  if (!iso) return '';
  const delta = new Date(iso).getTime() - Date.now();
  if (delta <= 0) return t('events.startsNow');
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return t('events.scheduledIn', { label: `${minutes}m` });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('events.scheduledIn', { label: `${hours}h` });
  const days = Math.round(hours / 24);
  return t('events.scheduledIn', { label: `${days}d` });
};

interface CardProps {
  event: ScheduledEvent;
  isMine: boolean;
  onToggle: (event: ScheduledEvent, nextState: boolean) => void;
}

const EventCard: React.FC<CardProps> = memo(({ event, isMine, onToggle }) => {
  const { t } = useTranslation();
  const handleToggle = useCallback(() => onToggle(event, !isMine), [event, isMine, onToggle]);

  return (
    <View className="rounded-md bg-overlay-white-5 border border-overlay-white-10 p-xxl gap-lg">
      <View className="flex-row items-start gap-md">
        <Avatar
          uri={event.host.avatarUrl ?? undefined}
          name={event.host.displayName}
          sizeValue={40}
        />
        <View className="flex-1 gap-xxs">
          <Text className="text-md font-display text-ink" numberOfLines={2}>
            {event.title}
          </Text>
          <Text className="text-xs text-ink-muted">
            {t('events.hostBy', { handle: event.host.displayName })}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center gap-sm">
        <MaterialIcons name="schedule" size={16} color={colors.primary} />
        <Text className="text-sm text-ink-muted">{formatRelative(event.scheduledFor, t)}</Text>
        {event.rsvpCount > 0 && (
          <>
            <Text className="text-xs text-ink-dim">·</Text>
            <Text className="text-sm text-ink-muted">
              {event.rsvpCount} {event.rsvpCount === 1 ? 'attendee' : 'attendees'}
            </Text>
          </>
        )}
      </View>

      <Pressable
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityState={{ selected: isMine }}
        className={
          isMine
            ? 'rounded-pill bg-primary-container py-sm items-center'
            : 'rounded-pill bg-primary py-sm items-center'
        }
      >
        <Text
          className={
            isMine
              ? 'text-sm font-body-bold text-primary-on-container'
              : 'text-sm font-body-bold text-primary-on-container'
          }
        >
          {isMine ? t('events.rsvp') : t('events.notRsvp')}
        </Text>
      </Pressable>
    </View>
  );
});
EventCard.displayName = 'EventCard';

export const EventsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [tab, setTab] = useState<Tab>('upcoming');

  const upcoming = useUpcomingEvents();
  const mine = useMyEvents();
  const rsvp = useRsvp();
  const cancelRsvp = useCancelRsvp();

  const mineIds = useMemo(() => new Set((mine.data ?? []).map(e => e.id)), [mine.data]);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const onToggle = useCallback(
    (event: ScheduledEvent, next: boolean) => {
      if (next) rsvp.mutate(event.id);
      else cancelRsvp.mutate(event.id);
    },
    [rsvp, cancelRsvp],
  );

  const activeList = tab === 'upcoming' ? upcoming : mine;
  const events = activeList.data ?? [];

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-xl font-display text-ink flex-1">{t('events.title')}</Text>
      </View>

      <View className="flex-row gap-md px-xxl pb-md">
        <TabPill
          label={t('events.tabs.upcoming')}
          active={tab === 'upcoming'}
          onPress={() => setTab('upcoming')}
        />
        <TabPill
          label={t('events.tabs.mine')}
          active={tab === 'mine'}
          onPress={() => setTab('mine')}
        />
      </View>

      {activeList.isLoading ? (
        <Loader fullscreen accessibilityLabel={t('events.title')} />
      ) : events.length === 0 ? (
        <EmptyState
          title={tab === 'mine' ? t('events.emptyMine') : t('events.empty')}
          description=""
        />
      ) : (
        <FlatList
          data={events}
          keyExtractor={e => e.id}
          renderItem={({ item }) => (
            <EventCard event={item} isMine={mineIds.has(item.id)} onToggle={onToggle} />
          )}
          ItemSeparatorComponent={() => <View className="h-md" />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingBottom: insets.bottom + spacing.huge,
          }}
          refreshing={activeList.isFetching}
          onRefresh={() => void activeList.refetch()}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const TabPill: React.FC<{ label: string; active: boolean; onPress: () => void }> = ({
  label,
  active,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    className={
      active
        ? 'px-xl py-sm rounded-pill bg-primary'
        : 'px-xl py-sm rounded-pill bg-overlay-white-5 border border-overlay-white-10'
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
