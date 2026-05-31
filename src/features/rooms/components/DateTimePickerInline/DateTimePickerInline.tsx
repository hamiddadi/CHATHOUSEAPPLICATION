import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ListRenderItem } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing } from '../../../../shared/constants/theme';

/**
 * JS-only date + time picker — no native module (no
 * @react-native-community/datetimepicker, which would need an EAS
 * dev-client). Renders horizontal lists of the next ~14 days, hours
 * (0-23) and minutes (5-min steps). Emits an ISO string that is always
 * clamped to the future, so it satisfies the backend's "ISO + future"
 * validation without any extra dependency.
 */

const DAYS_AHEAD = 14;
const MINUTE_STEP = 5;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Smallest sensible lead time so a "now-ish" pick still lands in the future
// by the time the request reaches the backend.
const MIN_LEAD_MS = 60 * 1000;

interface DayOption {
  /** Days from today (0 = today). */
  offset: number;
  /** Midnight timestamp for that calendar day. */
  startOfDay: number;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

const startOfDayMs = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Combine a calendar day with hour/minute into a local-time ISO string. */
const buildIso = (startOfDay: number, hour: number, minute: number): string => {
  const d = new Date(startOfDay);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

export interface DateTimePickerInlineProps {
  /** Current ISO value (date + time). */
  value: string;
  /** Fires with a future-clamped ISO string whenever the selection changes. */
  onChange: (iso: string) => void;
}

interface DayChipProps {
  option: DayOption;
  label: string;
  selected: boolean;
  a11yLabel: string;
  onPress: (option: DayOption) => void;
}

const DayChip: React.FC<DayChipProps> = memo(({ option, label, selected, a11yLabel, onPress }) => {
  const handlePress = useCallback(() => onPress(option), [onPress, option]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="radio"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ selected }}
      style={[styles.dayChip, selected ? styles.cellSelected : styles.cellUnselected]}
    >
      <Text
        numberOfLines={1}
        style={selected ? styles.dayLabelSelected : styles.dayLabelUnselected}
      >
        {label}
      </Text>
    </Pressable>
  );
});
DayChip.displayName = 'DayChip';

interface NumberCellProps {
  value: number;
  display: string;
  selected: boolean;
  a11yLabel: string;
  onPress: (value: number) => void;
}

const NumberCell: React.FC<NumberCellProps> = memo(
  ({ value, display, selected, a11yLabel, onPress }) => {
    const handlePress = useCallback(() => onPress(value), [onPress, value]);
    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="radio"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ selected }}
        style={[styles.numCell, selected ? styles.cellSelected : styles.cellUnselected]}
      >
        <Text style={selected ? styles.numLabelSelected : styles.numLabelUnselected}>
          {display}
        </Text>
      </Pressable>
    );
  },
);
NumberCell.displayName = 'NumberCell';

export const DateTimePickerInline: React.FC<DateTimePickerInlineProps> = ({ value, onChange }) => {
  const { t } = useTranslation();

  // Derive the editable parts from the incoming ISO once per change so the
  // component stays controlled by its parent.
  const parsed = useMemo(() => {
    const d = new Date(value);
    const safe = Number.isNaN(d.getTime()) ? new Date(Date.now() + MIN_LEAD_MS) : d;
    return {
      startOfDay: startOfDayMs(safe),
      hour: safe.getHours(),
      // Snap the minute onto the step grid so a cell is always highlighted.
      minute: Math.min(55, Math.round(safe.getMinutes() / MINUTE_STEP) * MINUTE_STEP),
    };
  }, [value]);

  const [todayStart, setTodayStart] = useState(() => startOfDayMs(new Date()));

  // Refresh the day grid if the component happens to outlive midnight.
  useEffect(() => {
    setTodayStart(startOfDayMs(new Date()));
  }, [value]);

  const days = useMemo<DayOption[]>(
    () =>
      Array.from({ length: DAYS_AHEAD }, (_, offset) => ({
        offset,
        startOfDay: todayStart + offset * MS_PER_DAY,
      })),
    [todayStart],
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    [],
  );

  const dayLabel = useCallback(
    (option: DayOption): string => {
      if (option.offset === 0) return t('dateTimePicker.today', 'Today');
      if (option.offset === 1) return t('dateTimePicker.tomorrow', 'Tomorrow');
      return dateFormatter.format(new Date(option.startOfDay));
    },
    [dateFormatter, t],
  );

  /** Emit, clamping the combined instant into the future when needed. */
  const emit = useCallback(
    (startOfDay: number, hour: number, minute: number) => {
      const candidate = new Date(startOfDay);
      candidate.setHours(hour, minute, 0, 0);
      const floor = Date.now() + MIN_LEAD_MS;
      if (candidate.getTime() < floor) {
        onChange(new Date(floor).toISOString());
        return;
      }
      onChange(buildIso(startOfDay, hour, minute));
    },
    [onChange],
  );

  const handleDayPress = useCallback(
    (option: DayOption) => emit(option.startOfDay, parsed.hour, parsed.minute),
    [emit, parsed.hour, parsed.minute],
  );
  const handleHourPress = useCallback(
    (hour: number) => emit(parsed.startOfDay, hour, parsed.minute),
    [emit, parsed.startOfDay, parsed.minute],
  );
  const handleMinutePress = useCallback(
    (minute: number) => emit(parsed.startOfDay, parsed.hour, minute),
    [emit, parsed.startOfDay, parsed.hour],
  );

  const dayListRef = useRef<FlatList<DayOption>>(null);

  const renderDay = useCallback<ListRenderItem<DayOption>>(
    ({ item }) => {
      const selected = item.startOfDay === parsed.startOfDay;
      const label = dayLabel(item);
      return (
        <DayChip
          option={item}
          label={label}
          selected={selected}
          a11yLabel={t('dateTimePicker.dayA11y', { date: label, defaultValue: `Date: {{date}}` })}
          onPress={handleDayPress}
        />
      );
    },
    [dayLabel, handleDayPress, parsed.startOfDay, t],
  );

  const renderHour = useCallback<ListRenderItem<number>>(
    ({ item }) => {
      const display = pad2(item);
      return (
        <NumberCell
          value={item}
          display={display}
          selected={item === parsed.hour}
          a11yLabel={t('dateTimePicker.hourA11y', {
            hour: display,
            defaultValue: `Hour {{hour}}`,
          })}
          onPress={handleHourPress}
        />
      );
    },
    [handleHourPress, parsed.hour, t],
  );

  const renderMinute = useCallback<ListRenderItem<number>>(
    ({ item }) => {
      const display = pad2(item);
      return (
        <NumberCell
          value={item}
          display={display}
          selected={item === parsed.minute}
          a11yLabel={t('dateTimePicker.minuteA11y', {
            minute: display,
            defaultValue: `Minute {{minute}}`,
          })}
          onPress={handleMinutePress}
        />
      );
    },
    [handleMinutePress, parsed.minute, t],
  );

  const summary = useMemo(() => {
    const d = new Date(buildIso(parsed.startOfDay, parsed.hour, parsed.minute));
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  }, [parsed.hour, parsed.minute, parsed.startOfDay]);

  return (
    <View style={styles.container} accessibilityRole="adjustable">
      <Text style={styles.sectionLabel}>{t('dateTimePicker.dateLabel', 'Date')}</Text>
      <FlatList
        ref={dayListRef}
        data={days}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => String(item.offset)}
        renderItem={renderDay}
        contentContainerStyle={styles.rowContent}
        accessibilityRole="radiogroup"
      />

      <Text style={styles.sectionLabel}>{t('dateTimePicker.timeLabel', 'Time')}</Text>
      <View style={styles.timeRow}>
        <View style={styles.timeColumn}>
          <Text style={styles.subLabel}>{t('dateTimePicker.hours', 'Hours')}</Text>
          <FlatList
            data={HOURS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `h${item}`}
            renderItem={renderHour}
            contentContainerStyle={styles.rowContent}
            accessibilityRole="radiogroup"
          />
        </View>
        <View style={styles.timeColumn}>
          <Text style={styles.subLabel}>{t('dateTimePicker.minutes', 'Minutes')}</Text>
          <FlatList
            data={MINUTES}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={item => `m${item}`}
            renderItem={renderMinute}
            contentContainerStyle={styles.rowContent}
            accessibilityRole="radiogroup"
          />
        </View>
      </View>

      <Text style={styles.summary} accessibilityLabel={summary}>
        {summary}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginLeft: spacing.xs,
  },
  subLabel: {
    color: colors.textDim,
    fontSize: 11,
    marginLeft: spacing.xs,
    marginBottom: spacing.xxs,
  },
  rowContent: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.xxs,
  },
  timeRow: {
    gap: spacing.md,
  },
  timeColumn: {
    gap: spacing.xxs,
  },
  dayChip: {
    minWidth: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numCell: {
    minWidth: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  cellUnselected: {
    borderColor: colors.outline,
    backgroundColor: colors.transparent,
  },
  dayLabelSelected: {
    color: colors.background,
    fontWeight: '700',
    fontSize: 13,
  },
  dayLabelUnselected: {
    color: colors.text,
    fontWeight: '500',
    fontSize: 13,
  },
  numLabelSelected: {
    color: colors.background,
    fontWeight: '700',
    fontSize: 15,
  },
  numLabelUnselected: {
    color: colors.text,
    fontWeight: '500',
    fontSize: 15,
  },
  summary: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: spacing.xs,
    marginTop: spacing.xxs,
  },
});
