import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { colors, radii, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { useCreateRoom } from '../../hooks/useRooms';
import { searchService } from '../../../search/services/searchService';
import { INTEREST_CATEGORIES } from '../../../onboarding/schemas';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'CreateRoom'>;

type Visibility = 'public' | 'social' | 'closed';

interface VisibilityOption {
  id: Visibility;
  icon: 'public' | 'people' | 'lock';
  label: string;
  description: string;
}

const VISIBILITY_OPTIONS: readonly VisibilityOption[] = [
  { id: 'public', icon: 'public', label: 'Open', description: 'Anyone in Chathouse can join' },
  { id: 'social', icon: 'people', label: 'Social', description: 'Only people you follow can join' },
  { id: 'closed', icon: 'lock', label: 'Closed', description: 'Only people you invite' },
];

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 200;
const MAX_TOPICS = 5;
const MAX_COHOSTS = 5;
const SEARCH_DEBOUNCE_MS = 250;

// Presets keep the UX one-tap without pulling a native date picker (which
// would need EAS dev-client). Custom datetime selection lands later.
const SCHEDULE_PRESETS = [
  { id: '30min', label: '+30 min', minutes: 30 },
  { id: '1h', label: '+1 h', minutes: 60 },
  { id: '3h', label: '+3 h', minutes: 180 },
  { id: '1d', label: '+1 j', minutes: 60 * 24 },
] as const;
type SchedulePresetId = (typeof SCHEDULE_PRESETS)[number]['id'];

interface VisibilityRowProps {
  option: VisibilityOption;
  selected: boolean;
  onPress: (id: Visibility) => void;
}

const VisibilityRow: React.FC<VisibilityRowProps> = memo(({ option, selected, onPress }) => {
  const handlePress = useCallback(() => onPress(option.id), [option.id, onPress]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="radio"
      accessibilityLabel={`${option.label}: ${option.description}`}
      accessibilityState={{ selected }}
      className={
        selected
          ? 'flex-row items-center gap-md p-lg rounded-md bg-primary-container'
          : 'flex-row items-center gap-md p-lg rounded-md bg-overlay-white-5 border border-overlay-white-10'
      }
    >
      <MaterialIcons
        name={option.icon}
        size={24}
        color={selected ? colors.onPrimaryContainer : colors.text}
      />
      <View className="flex-1">
        <Text
          className={
            selected
              ? 'text-md font-body-bold text-primary-on-container'
              : 'text-md font-body-bold text-ink'
          }
        >
          {option.label}
        </Text>
        <Text
          className={
            selected
              ? 'text-xs font-body text-primary-on-container opacity-80'
              : 'text-xs font-body text-ink-muted'
          }
        >
          {option.description}
        </Text>
      </View>
      {selected && <MaterialIcons name="check" size={20} color={colors.onPrimaryContainer} />}
    </Pressable>
  );
});
VisibilityRow.displayName = 'VisibilityRow';

interface TopicChipProps {
  topic: string;
  selected: boolean;
  onPress: (topic: string) => void;
}

const TopicChip: React.FC<TopicChipProps> = memo(({ topic, selected, onPress }) => {
  const handlePress = useCallback(() => onPress(topic), [onPress, topic]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
    >
      <Text style={selected ? styles.chipLabelSelected : styles.chipLabelUnselected}>{topic}</Text>
    </Pressable>
  );
});
TopicChip.displayName = 'TopicChip';

interface CoHostSlotProps {
  user: { id: string; username: string; displayName: string; avatarUrl: string | null };
  onRemove: (id: string) => void;
}

const CoHostSlot: React.FC<CoHostSlotProps> = memo(({ user, onRemove }) => {
  const handleRemove = useCallback(() => onRemove(user.id), [onRemove, user.id]);
  return (
    <View className="flex-row items-center gap-sm bg-overlay-white-5 rounded-pill px-sm py-xs">
      <Avatar uri={user.avatarUrl ?? undefined} name={user.displayName} sizeValue={24} />
      <Text className="text-xs text-ink">@{user.username}</Text>
      <Pressable onPress={handleRemove} accessibilityRole="button" hitSlop={8}>
        <MaterialIcons name="close" size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
});
CoHostSlot.displayName = 'CoHostSlot';

interface SearchHit {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export const CreateRoomScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [isScheduled, setIsScheduled] = useState(false);
  const [schedulePreset, setSchedulePreset] = useState<SchedulePresetId>('1h');
  const [topics, setTopics] = useState<Set<string>>(new Set());
  const [coHosts, setCoHosts] = useState<SearchHit[]>([]);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length === 0) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void searchService
      .users(debouncedQuery, 8)
      .then(rows => {
        if (cancelled) return;
        setSearchResults(
          rows.map(r => ({
            id: r.id,
            username: r.username,
            displayName: r.displayName,
            avatarUrl: r.avatarUrl,
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const createRoom = useCreateRoom();

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const toggleTopic = useCallback((topic: string) => {
    setTopics(prev => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else if (next.size < MAX_TOPICS) next.add(topic);
      return next;
    });
  }, []);

  const addCoHost = useCallback((hit: SearchHit) => {
    setCoHosts(prev => {
      if (prev.length >= MAX_COHOSTS) return prev;
      if (prev.some(u => u.id === hit.id)) return prev;
      return [...prev, hit];
    });
    setQuery('');
    setSearchResults([]);
  }, []);

  const removeCoHost = useCallback((id: string) => {
    setCoHosts(prev => prev.filter(u => u.id !== id));
  }, []);

  const handleStart = useCallback(async () => {
    let scheduledFor: string | undefined;
    if (isScheduled) {
      const preset = SCHEDULE_PRESETS.find(p => p.id === schedulePreset);
      if (preset) {
        scheduledFor = new Date(Date.now() + preset.minutes * 60_000).toISOString();
      }
    }
    try {
      await createRoom.mutateAsync({
        title,
        description: description.trim() || undefined,
        visibility,
        topics: [...topics],
        coHostIds: coHosts.map(u => u.id),
        scheduledFor,
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert(
        t('createRoom.errorTitle'),
        err instanceof Error ? err.message : t('createRoom.errorBody'),
      );
    }
  }, [
    createRoom,
    description,
    navigation,
    title,
    visibility,
    topics,
    coHosts,
    isScheduled,
    schedulePreset,
    t,
  ]);
  const handleToggleSchedule = useCallback(() => setIsScheduled(prev => !prev), []);

  const canStart = title.trim().length > 0 && !createRoom.isPending;
  const topicsArray = useMemo(() => [...topics], [topics]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t('createRoom.closeA11y')}
          hitSlop={8}
        >
          <MaterialIcons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">{t('createRoom.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label={t('createRoom.topicLabel')}
          placeholder={t('createRoom.topicPlaceholder')}
          value={title}
          onChangeText={setTitle}
          maxLength={TITLE_MAX}
          helperText={`${title.length} / ${TITLE_MAX}`}
        />

        <Input
          label={t('createRoom.descriptionLabel')}
          placeholder={t('createRoom.descriptionPlaceholder')}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={DESCRIPTION_MAX}
          helperText={`${description.length} / ${DESCRIPTION_MAX}`}
        />

        <View className="gap-sm">
          <Text className="text-xs font-body-medium text-ink-muted ml-xs">
            {t('createRoom.visibilityLabel')}
          </Text>
          <View className="gap-sm">
            {VISIBILITY_OPTIONS.map(opt => (
              <VisibilityRow
                key={opt.id}
                option={opt}
                selected={visibility === opt.id}
                onPress={setVisibility}
              />
            ))}
          </View>
        </View>

        <View className="gap-sm">
          <Text className="text-xs font-body-medium text-ink-muted ml-xs">
            {t('createRoom.topicsLabel')}
            {topicsArray.length > 0 ? `  ·  ${topicsArray.length}/${MAX_TOPICS}` : ''}
          </Text>
          <Text className="text-xs font-body text-ink-dim ml-xs">{t('createRoom.topicsHint')}</Text>
          <View className="flex-row flex-wrap gap-sm pt-xs">
            {INTEREST_CATEGORIES.map(cat => (
              <TopicChip key={cat} topic={cat} selected={topics.has(cat)} onPress={toggleTopic} />
            ))}
          </View>
        </View>

        <View className="gap-sm">
          <Text className="text-xs font-body-medium text-ink-muted ml-xs">
            {t('createRoom.coHostsLabel')}
            {coHosts.length > 0 ? `  ·  ${coHosts.length}/${MAX_COHOSTS}` : ''}
          </Text>
          <Text className="text-xs font-body text-ink-dim ml-xs">
            {t('createRoom.coHostsHint')}
          </Text>
          {coHosts.length > 0 && (
            <View className="flex-row flex-wrap gap-sm pt-xs">
              {coHosts.map(u => (
                <CoHostSlot key={u.id} user={u} onRemove={removeCoHost} />
              ))}
            </View>
          )}
          {coHosts.length < MAX_COHOSTS && (
            <Input
              placeholder={t('createRoom.coHostsSearchPlaceholder')}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
            />
          )}
          {searchResults.length > 0 && (
            <View className="gap-xs pt-xs">
              {searchResults.map(hit => (
                <Pressable
                  key={hit.id}
                  onPress={() => addCoHost(hit)}
                  accessibilityRole="button"
                  className="flex-row items-center gap-md p-sm rounded-md bg-overlay-white-5"
                >
                  <Avatar uri={hit.avatarUrl ?? undefined} name={hit.displayName} sizeValue={32} />
                  <View className="flex-1">
                    <Text className="text-sm font-body-medium text-ink">
                      {hit.displayName || hit.username}
                    </Text>
                    <Text className="text-xs text-ink-muted">@{hit.username}</Text>
                  </View>
                  <MaterialIcons name="add" size={20} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          )}
          {searching && debouncedQuery.length > 0 && (
            <Text className="text-xs text-ink-dim ml-xs">…</Text>
          )}
        </View>

        <Pressable
          onPress={handleToggleSchedule}
          accessibilityRole="switch"
          accessibilityLabel={t('createRoom.scheduleLabel')}
          accessibilityState={{ checked: isScheduled }}
          className="flex-row items-center gap-md p-lg rounded-md bg-overlay-white-5 border border-overlay-white-10"
        >
          <MaterialIcons name="calendar-today" size={24} color={colors.text} />
          <View className="flex-1">
            <Text className="text-md font-body-bold text-ink">{t('createRoom.scheduleLabel')}</Text>
            <Text className="text-xs font-body text-ink-muted">{t('createRoom.scheduleHint')}</Text>
          </View>
          <View
            className={
              isScheduled
                ? 'w-[44px] h-[26px] bg-primary rounded-pill'
                : 'w-[44px] h-[26px] bg-surface-high rounded-pill'
            }
          >
            <View
              className={
                isScheduled
                  ? 'w-[22px] h-[22px] rounded-pill bg-white mt-xxs ml-[20px]'
                  : 'w-[22px] h-[22px] rounded-pill bg-ink-muted mt-xxs ml-xxs'
              }
            />
          </View>
        </Pressable>

        {isScheduled && (
          <View className="flex-row flex-wrap gap-sm pt-xs">
            {SCHEDULE_PRESETS.map(preset => {
              const selected = schedulePreset === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => setSchedulePreset(preset.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Schedule ${preset.label}`}
                  accessibilityState={{ selected }}
                  style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
                >
                  <Text style={selected ? styles.chipLabelSelected : styles.chipLabelUnselected}>
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Button
          label={t('createRoom.startRoom')}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canStart}
          loading={createRoom.isPending}
          onPress={handleStart}
        />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  headerSpacer: { width: 24 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.xxl,
    borderWidth: 1,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  chipUnselected: {
    borderColor: colors.outline,
    backgroundColor: 'transparent',
  },
  chipLabelSelected: { color: colors.background, fontWeight: '700' },
  chipLabelUnselected: { color: colors.text, fontWeight: '500' },
});
