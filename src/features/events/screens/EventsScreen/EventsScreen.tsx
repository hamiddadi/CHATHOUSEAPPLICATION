import React, { memo, useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
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
import { useAuthStore } from '../../../auth/store/authStore';
import { ExtCalendarExportButton, eventsApi } from '../../../extensions';
import { DateTimePickerInline } from '../../../rooms/components/DateTimePickerInline';
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
  isHost: boolean;
  onToggle: (event: ScheduledEvent, nextState: boolean) => void;
  onCancel: (event: ScheduledEvent) => void;
  onReschedule: (event: ScheduledEvent) => void;
  disabled?: boolean;
}

const EventCard: React.FC<CardProps> = memo(
  ({ event, isMine, isHost, onToggle, onCancel, onReschedule, disabled = false }) => {
    const { t } = useTranslation();
    const handleToggle = useCallback(() => onToggle(event, !isMine), [event, isMine, onToggle]);
    const handleCancel = useCallback(() => onCancel(event), [event, onCancel]);
    const handleReschedule = useCallback(() => onReschedule(event), [event, onReschedule]);

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
                {t('events.attendeeCount', { count: event.rsvpCount })}
              </Text>
            </>
          )}
        </View>

        <Pressable
          onPress={handleToggle}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: isMine, disabled }}
          // Compose the a11y label from existing i18n keys + the event title so a
          // screen reader announces which event the button acts on. (No new locale
          // keys are added here — those files are owned elsewhere.)
          accessibilityLabel={`${isMine ? t('events.rsvp') : t('events.notRsvp')} · ${event.title}`}
          className={
            isMine
              ? 'rounded-pill bg-primary-container py-sm items-center'
              : 'rounded-pill bg-primary py-sm items-center'
          }
        >
          <Text className="text-sm font-body-bold text-primary-on-container">
            {isMine ? t('events.rsvp') : t('events.notRsvp')}
          </Text>
        </Pressable>

        {/* Calendar export + (host-only) cancel — surfaced from the extensions
            module. Aligned start so the .ics button keeps its intrinsic width. */}
        <View className="flex-row items-center gap-md flex-wrap">
          <ExtCalendarExportButton
            roomId={event.id}
            label={t('extensions.events.addToCalendar', 'Add to calendar')}
          />
          {isHost && (
            <>
              <Pressable
                onPress={handleReschedule}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                accessibilityLabel={`${t('extensions.events.reschedule', 'Reprogrammer')} · ${event.title}`}
                className="rounded-pill bg-overlay-white-5 border border-overlay-white-20 px-xl py-sm items-center"
              >
                <Text className="text-sm font-body-bold text-ink">
                  {t('extensions.events.reschedule', 'Reprogrammer')}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleCancel}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                accessibilityLabel={`${t('extensions.events.cancelEvent', 'Cancel event')} · ${event.title}`}
                className="rounded-pill bg-overlay-white-5 border border-danger px-xl py-sm items-center"
              >
                <Text className="text-sm font-body-bold text-danger">
                  {t('extensions.events.cancelEvent', 'Cancel event')}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  },
);
EventCard.displayName = 'EventCard';

export const EventsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [tab, setTab] = useState<Tab>('upcoming');
  const [canceling, setCanceling] = useState(false);
  const [reschedulingEvent, setReschedulingEvent] = useState<ScheduledEvent | null>(null);
  const [newDate, setNewDate] = useState('');
  const [rescheduling, setRescheduling] = useState(false);

  const viewerId = useAuthStore(s => s.user?.id ?? null);

  const upcoming = useUpcomingEvents();
  const mine = useMyEvents();
  const rsvp = useRsvp();
  const cancelRsvp = useCancelRsvp();

  const mineIds = useMemo(() => new Set((mine.data ?? []).map(e => e.id)), [mine.data]);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const mutating = rsvp.isPending || cancelRsvp.isPending || canceling;

  const onToggle = useCallback(
    (event: ScheduledEvent, next: boolean) => {
      // Prevent double-submission while a RSVP/cancel is in flight.
      if (rsvp.isPending || cancelRsvp.isPending) return;
      const opts = {
        onError: () => Alert.alert(t('events.title'), t('errorBoundary.fallbackMessage')),
      };
      if (next) rsvp.mutate(event.id, opts);
      else cancelRsvp.mutate(event.id, opts);
    },
    [rsvp, cancelRsvp, t],
  );

  // Host-only: confirm, then call the extensions cancel endpoint and refetch
  // both lists so the canceled room disappears from "Upcoming" and "Mine".
  const onCancel = useCallback(
    (event: ScheduledEvent) => {
      if (canceling) return;
      Alert.alert(
        t('extensions.events.cancelEvent', 'Cancel event'),
        t('extensions.events.cancelConfirm', {
          title: event.title,
          defaultValue:
            '“{{title}}” will be canceled and attendees notified. This cannot be undone.',
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.continue'),
            style: 'destructive',
            onPress: () => {
              setCanceling(true);
              eventsApi
                .cancel(event.id)
                .then(() => {
                  void upcoming.refetch();
                  void mine.refetch();
                })
                .catch(() => Alert.alert(t('events.title'), t('common.actionFailed')))
                .finally(() => setCanceling(false));
            },
          },
        ],
      );
    },
    [canceling, t, upcoming, mine],
  );

  // Host-only: open the reschedule sheet seeded with the event's current time.
  const onReschedule = useCallback((event: ScheduledEvent) => {
    setReschedulingEvent(event);
    setNewDate(event.scheduledFor);
  }, []);

  const confirmReschedule = useCallback(() => {
    if (!reschedulingEvent || !newDate || rescheduling) return;
    setRescheduling(true);
    eventsApi
      .reschedule(reschedulingEvent.id, newDate)
      .then(() => {
        void upcoming.refetch();
        void mine.refetch();
        setReschedulingEvent(null);
      })
      .catch(() => Alert.alert(t('events.title'), t('common.actionFailed')))
      .finally(() => setRescheduling(false));
  }, [reschedulingEvent, newDate, rescheduling, upcoming, mine, t]);

  const activeList = tab === 'upcoming' ? upcoming : mine;
  const events = activeList.data ?? [];

  const keyExtractor = useCallback((e: ScheduledEvent) => e.id, []);
  const renderItem = useCallback(
    ({ item }: { item: ScheduledEvent }) => (
      <EventCard
        event={item}
        isMine={mineIds.has(item.id)}
        isHost={viewerId != null && item.hostId === viewerId}
        onToggle={onToggle}
        onCancel={onCancel}
        onReschedule={onReschedule}
        disabled={mutating}
      />
    ),
    [mineIds, viewerId, onToggle, onCancel, onReschedule, mutating],
  );
  const renderSeparator = useCallback(() => <View className="h-md" />, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
        >
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
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ItemSeparatorComponent={renderSeparator}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingBottom: insets.bottom + spacing.huge,
          }}
          refreshing={activeList.isFetching}
          onRefresh={() => void activeList.refetch()}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={reschedulingEvent != null}
        transparent
        animationType="slide"
        onRequestClose={() => setReschedulingEvent(null)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setReschedulingEvent(null)}
          accessibilityLabel={t('common.cancel')}
        >
          <Pressable
            className="bg-surface-high rounded-t-3xl p-xxl gap-lg"
            onPress={() => undefined}
          >
            <Text className="text-lg font-display text-ink">
              {t('extensions.events.reschedule', 'Reprogrammer')}
            </Text>
            {reschedulingEvent ? (
              <Text className="text-sm text-ink-muted" numberOfLines={1}>
                {reschedulingEvent.title}
              </Text>
            ) : null}
            {newDate ? <DateTimePickerInline value={newDate} onChange={setNewDate} /> : null}
            <Pressable
              onPress={confirmReschedule}
              disabled={rescheduling}
              accessibilityRole="button"
              accessibilityLabel={t('common.continue')}
              className="rounded-pill bg-primary py-md items-center"
            >
              <Text className="text-sm font-body-bold text-primary-on-container">
                {t('common.continue')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
