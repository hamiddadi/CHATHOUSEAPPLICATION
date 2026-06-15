import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { useExtSearchHistory, useExtSearchRooms } from '../../../extensions';
import { useDebouncedValue } from '../../../../shared/hooks/useDebouncedValue';
import { useExplore, useSearch, useTopicSearch } from '../../hooks/useSearch';
import type { SearchRoomHit } from '../../services/searchService';
import { SearchResultsView } from './partials/SearchResultsView';
import { ExploreFeedView } from './partials/ExploreFeedView';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Explore'>;

/**
 * One search bar + trending feed. While the user types we switch to
 * the search results view; empty query shows the explore feed. A
 * lightweight debounce keeps keystrokes cheap even though the backend
 * trigram index makes this cheap too.
 */
const DEBOUNCE_MS = 200;

// Faceted filters for room search (#63 language / #64 category). Languages map
// to the backend's `lang:<iso>` topic convention; categories match Room.topics.
const FILTER_LANGS = ['fr', 'en', 'ar', 'es'] as const;
const FILTER_CATS = ['tech', 'music', 'business', 'health', 'design', 'ai'] as const;

export const ExploreScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [rawQuery, setRawQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const debouncedQuery = useDebouncedValue(rawQuery.trim(), DEBOUNCE_MS);

  const explore = useExplore();
  const search = useSearch(debouncedQuery);
  const topicHits = useTopicSearch(debouncedQuery);
  const history = useExtSearchHistory();

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
  const goTopics = useCallback(() => navigation.navigate('TopicExplorer'), [navigation]);

  // Persist a meaningful search (on submit) and replay a recent one on tap.
  const recordSearch = useCallback(() => history.commit(rawQuery), [history, rawQuery]);
  const replaySearch = useCallback(
    (query: string) => {
      setRawQuery(query);
      history.commit(query);
    },
    [history],
  );

  const isSearching = debouncedQuery.length > 0;
  const showRecent = !isSearching && searchFocused && history.items.length > 0;

  // #63/#64: language + category facets. When active they drive a server-side
  // filtered room search (ext/search/rooms) shown above the default results.
  const [langFilter, setLangFilter] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const filterActive = langFilter != null || catFilter != null;
  const toggleLang = useCallback(
    (code: string) => setLangFilter(p => (p === code ? null : code)),
    [],
  );
  const toggleCat = useCallback(
    (code: string) => setCatFilter(p => (p === code ? null : code)),
    [],
  );
  const extRooms = useExtSearchRooms(
    {
      q: debouncedQuery,
      language: langFilter ?? undefined,
      topic: catFilter ?? undefined,
      liveOnly: true,
    },
    isSearching && filterActive,
  );
  const filteredRooms = useMemo<SearchRoomHit[]>(
    () =>
      (extRooms.data ?? []).map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        topic: r.topic,
        isLive: r.isLive,
        scheduledFor: r.scheduledFor,
        host: {
          id: r.host.id,
          username: r.host.username ?? '',
          displayName: r.host.displayName ?? '',
          avatarUrl: r.host.avatarUrl,
        },
        listenersCount: r.participantCount,
      })),
    [extRooms.data],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-xl font-display text-ink flex-1">{t('explore.title')}</Text>
        <Pressable
          onPress={goTopics}
          accessibilityRole="button"
          hitSlop={8}
          className="flex-row items-center gap-xs"
        >
          <MaterialIcons name="explore" size={18} color={colors.primary} />
          <Text className="text-sm font-body-medium text-primary">{t('explore.browseTopics')}</Text>
        </Pressable>
      </View>

      <View className="px-xxl pb-md">
        <Input
          placeholder={t('explore.searchPlaceholder')}
          value={rawQuery}
          onChangeText={setRawQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onSubmitEditing={recordSearch}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
        />
      </View>

      {isSearching ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.xs, paddingHorizontal: spacing.xxl }}
          className="pb-md flex-grow-0"
        >
          {FILTER_LANGS.map(code => (
            <FilterChip
              key={`l-${code}`}
              label={code.toUpperCase()}
              active={langFilter === code}
              onPress={() => toggleLang(code)}
            />
          ))}
          {FILTER_CATS.map(code => (
            <FilterChip
              key={`c-${code}`}
              label={code}
              active={catFilter === code}
              onPress={() => toggleCat(code)}
            />
          ))}
        </ScrollView>
      ) : null}

      {showRecent ? (
        <RecentSearchesView
          items={history.items}
          bottomInset={insets.bottom}
          onPick={replaySearch}
          onClear={() => void history.clear()}
          t={t}
        />
      ) : isSearching ? (
        search.isLoading ? (
          <Loader fullscreen accessibilityLabel={t('explore.searchResults')} />
        ) : (
          <SearchResultsView
            data={search.data}
            topics={topicHits.data}
            filteredRooms={filterActive ? filteredRooms : undefined}
            debouncedQuery={debouncedQuery}
            bottomInset={insets.bottom}
            goUser={goUser}
            goClub={goClub}
            goRoom={goRoom}
            goTopic={goTopics}
            t={t}
          />
        )
      ) : explore.isLoading ? (
        <Loader fullscreen accessibilityLabel={t('explore.title')} />
      ) : (
        <ExploreFeedView
          data={explore.data}
          bottomInset={insets.bottom}
          isFetching={explore.isFetching}
          onRefresh={() => void explore.refetch()}
          goUser={goUser}
          goClub={goClub}
          goRoom={goRoom}
          t={t}
        />
      )}
    </View>
  );
};

const FilterChip: React.FC<{ label: string; active: boolean; onPress: () => void }> = ({
  label,
  active,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={`Filtre ${label}`}
    className={
      active
        ? 'px-md py-xs rounded-pill bg-primary'
        : 'px-md py-xs rounded-pill bg-overlay-white-5 border border-overlay-white-10'
    }
  >
    <Text
      className={
        active
          ? 'text-xs font-body-bold text-primary-on-container uppercase'
          : 'text-xs font-body-bold text-ink-muted uppercase'
      }
    >
      {label}
    </Text>
  </Pressable>
);

interface RecentSearchesViewProps {
  items: readonly string[];
  bottomInset: number;
  onPick: (query: string) => void;
  onClear: () => void;
  t: TFunction;
}

/** Recent searches shown when the bar is empty and focused — tap to re-run. */
const RecentSearchesView: React.FC<RecentSearchesViewProps> = ({
  items,
  bottomInset,
  onPick,
  onClear,
  t,
}) => (
  <ScrollView
    contentContainerStyle={{
      paddingBottom: bottomInset + spacing.huge,
      paddingHorizontal: spacing.xxl,
    }}
    keyboardShouldPersistTaps="handled"
    showsVerticalScrollIndicator={false}
  >
    <View className="flex-row items-center justify-between mb-md">
      <Text className="text-sm font-body-bold text-ink-muted uppercase tracking-wider">
        {t('explore.recentSearches')}
      </Text>
      <Pressable onPress={onClear} accessibilityRole="button" hitSlop={8}>
        <Text className="text-sm font-body-medium text-primary">{t('explore.clearHistory')}</Text>
      </Pressable>
    </View>
    {items.map(query => (
      <Pressable
        key={query}
        onPress={() => onPick(query)}
        accessibilityRole="button"
        className="flex-row items-center gap-md py-md"
      >
        <MaterialIcons name="history" size={20} color={colors.textMuted} />
        <Text className="text-md text-ink flex-1" numberOfLines={1}>
          {query}
        </Text>
      </Pressable>
    ))}
  </ScrollView>
);
