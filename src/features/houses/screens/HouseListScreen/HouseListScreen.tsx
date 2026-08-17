import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Input } from '../../../../shared/components/Input';
import { useAnimatedPress } from '../../../../shared/hooks/useAnimatedPress';
import { useDebouncedValue } from '../../../../shared/hooks/useDebouncedValue';
import { colors, layout, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { HouseSummary } from '../../../../shared/types/domain';
import { useHouses, useHouseSearch } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'HouseList'>;
type Tab = 'mine' | 'discover';

const FAB_BOTTOM_OFFSET = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.xl;
const HOUSE_ICON_SIZE = 56;
const SEARCH_DEBOUNCE_MS = 250;

const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Match all query words against a member's house name or category. */
export const filterMyHouses = (houses: readonly HouseSummary[], query: string): HouseSummary[] => {
  const tokens = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...houses];

  return houses.filter(house => {
    const searchable = normalizeSearchText(`${house.name} ${house.category}`);
    return tokens.every(token => searchable.includes(token));
  });
};

interface HouseRowProps {
  house: HouseSummary;
  onPress: (id: string) => void;
}

const HouseRow: React.FC<HouseRowProps> = memo(({ house, onPress }) => {
  const { t } = useTranslation();
  const press = useAnimatedPress({ scaleTo: 0.98 });
  const handle = useCallback(() => onPress(house.id), [house.id, onPress]);
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={handle}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={t('houses.openHouseA11y', 'Open house {{name}}', { name: house.name })}
        className="flex-row items-center gap-md p-lg rounded-md bg-overlay-white-5 border border-overlay-white-10"
      >
        <Avatar
          uri={house.iconUrl ?? undefined}
          name={house.name}
          sizeValue={HOUSE_ICON_SIZE}
          shape="squircle"
        />
        <View className="flex-1 gap-xxs">
          <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
            {house.name}
          </Text>
          <View className="flex-row items-center gap-sm">
            {/* The category chip is hidden until house creation actually offers
                a category choice — today every house is created with the
                backend default ('tech'), so showing it was pure noise. */}
            <Text className="text-xs font-body text-ink-muted">
              {t('houses.membersCount', '{{countStr}} members', {
                countStr: house.membersCount.toLocaleString(),
              })}
            </Text>
          </View>
        </View>
        <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
});
HouseRow.displayName = 'HouseRow';

interface TabToggleProps {
  value: Tab;
  onChange: (t: Tab) => void;
}

const TabToggle: React.FC<TabToggleProps> = memo(({ value, onChange }) => {
  const { t } = useTranslation();
  const setMine = useCallback(() => onChange('mine'), [onChange]);
  const setDiscover = useCallback(() => onChange('discover'), [onChange]);
  return (
    <View className="flex-row bg-surface-high rounded-pill p-xxs">
      <Pressable
        onPress={setMine}
        accessibilityRole="tab"
        accessibilityState={{ selected: value === 'mine' }}
        hitSlop={{ top: 8, bottom: 8 }}
        className={
          value === 'mine'
            ? 'flex-1 py-sm rounded-pill bg-primary items-center'
            : 'flex-1 py-sm items-center'
        }
      >
        <Text
          className={
            value === 'mine'
              ? 'text-sm font-body-bold text-primary-on-container'
              : 'text-sm font-body-bold text-ink-muted'
          }
        >
          {t('houses.tabs.mine', 'My Houses')}
        </Text>
      </Pressable>
      <Pressable
        onPress={setDiscover}
        accessibilityRole="tab"
        accessibilityState={{ selected: value === 'discover' }}
        hitSlop={{ top: 8, bottom: 8 }}
        className={
          value === 'discover'
            ? 'flex-1 py-sm rounded-pill bg-primary items-center'
            : 'flex-1 py-sm items-center'
        }
      >
        <Text
          className={
            value === 'discover'
              ? 'text-sm font-body-bold text-primary-on-container'
              : 'text-sm font-body-bold text-ink-muted'
          }
        >
          {t('houses.tabs.discover', 'Discover')}
        </Text>
      </Pressable>
    </View>
  );
});
TabToggle.displayName = 'TabToggle';

export const HouseListScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('mine');
  const [query, setQuery] = useState('');
  const fab = useAnimatedPress({ scaleTo: 0.9 });
  // Keep the viewer's memberships available while Discover is active so a
  // global search result cannot re-surface a House they have already joined.
  const mineHouses = useHouses('mine');
  const discoverHouses = useHouses('discover', tab === 'discover');
  const activeList = tab === 'mine' ? mineHouses : discoverHouses;
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery, SEARCH_DEBOUNCE_MS);
  const discoverSearch = useHouseSearch(debouncedQuery, tab === 'discover');
  const isDebouncingDiscover =
    tab === 'discover' && trimmedQuery.length > 0 && trimmedQuery !== debouncedQuery;
  const isDiscoverSearch =
    tab === 'discover' &&
    trimmedQuery.length > 0 &&
    trimmedQuery === debouncedQuery &&
    debouncedQuery.length > 0;
  const mineHouseIds = useMemo(
    () => new Set((mineHouses.data ?? []).map(house => house.id)),
    [mineHouses.data],
  );

  const visibleHouses = useMemo(() => {
    if (isDiscoverSearch) {
      return (discoverSearch.data ?? []).filter(house => !mineHouseIds.has(house.id));
    }
    if (tab === 'mine') return filterMyHouses(mineHouses.data ?? [], trimmedQuery);
    return discoverHouses.data ?? [];
  }, [
    discoverHouses.data,
    discoverSearch.data,
    isDiscoverSearch,
    mineHouseIds,
    mineHouses.data,
    tab,
    trimmedQuery,
  ]);

  const contentIsLoading =
    isDebouncingDiscover || (isDiscoverSearch ? discoverSearch.isLoading : activeList.isLoading);
  const contentIsError = isDiscoverSearch ? discoverSearch.isError : activeList.isError;
  const contentIsFetching = isDiscoverSearch ? discoverSearch.isFetching : activeList.isFetching;

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleOpenHouse = useCallback(
    (houseId: string) => navigation.navigate('HouseDetail', { houseId }),
    [navigation],
  );
  const handleCreate = useCallback(() => navigation.navigate('CreateHouse'), [navigation]);
  const handleClearSearch = useCallback(() => setQuery(''), []);
  const handleRetry = useCallback(() => {
    if (isDiscoverSearch) {
      void discoverSearch.refetch();
      return;
    }
    void activeList.refetch();
  }, [activeList, discoverSearch, isDiscoverSearch]);

  const renderItem = useCallback(
    ({ item }: { item: HouseSummary }) => <HouseRow house={item} onPress={handleOpenHouse} />,
    [handleOpenHouse],
  );
  const keyExtractor = useCallback((item: HouseSummary) => item.id, []);
  const renderSeparator = useCallback(() => <View className="h-md" />, []);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          // 24px icon + 2×10 hitSlop = 44px touch target.
          hitSlop={10}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">{t('houses.title', 'Houses')}</Text>
        {/* Right-side spacer keeps the title centered. */}
        <View className="w-6" />
      </View>

      <View className="px-xxl mb-lg">
        <TabToggle value={tab} onChange={setTab} />
      </View>

      <View className="px-xxl mb-lg">
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder={t('houses.searchPlaceholder', 'Search houses')}
          accessibilityLabel={t('houses.searchA11y', 'Search houses')}
          autoCorrect={false}
          returnKeyType="search"
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
          rightAdornment={
            query.length > 0 ? (
              <Pressable
                onPress={handleClearSearch}
                accessibilityRole="button"
                accessibilityLabel={t('houses.clearSearchA11y', 'Clear house search')}
                hitSlop={10}
              >
                <MaterialIcons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            ) : undefined
          }
        />
      </View>

      {contentIsLoading ? (
        <Loader
          fullscreen
          accessibilityLabel={
            trimmedQuery.length > 0
              ? t('houses.searching', 'Searching houses')
              : t('houses.loading', 'Loading houses')
          }
        />
      ) : contentIsError ? (
        <EmptyState
          title={
            isDiscoverSearch
              ? t('houses.searchErrorTitle', "Couldn't search houses")
              : t('houses.errorTitle', "Couldn't load houses")
          }
          description={
            isDiscoverSearch
              ? t('houses.searchErrorBody', 'Check your connection and try again.')
              : t('houses.errorBody', 'Check your connection.')
          }
          actionLabel={t('common.retry', 'Retry')}
          onAction={handleRetry}
        />
      ) : (
        <FlatList
          data={visibleHouses}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          refreshing={contentIsFetching}
          onRefresh={handleRetry}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              title={
                trimmedQuery.length > 0
                  ? t('houses.searchNoResultsTitle', 'No houses found')
                  : tab === 'mine'
                    ? t('houses.emptyMineTitle', 'No houses yet')
                    : t('houses.emptyDiscoverTitle', 'Nothing to discover')
              }
              description={
                trimmedQuery.length > 0
                  ? t('houses.searchNoResultsBody', 'Nothing matches “{{query}}”.', {
                      query: trimmedQuery,
                    })
                  : tab === 'mine'
                    ? t('houses.emptyMineBody', 'Join a house or create your own community.')
                    : t('houses.emptyDiscoverBody', 'Be the first — create a house.')
              }
              actionLabel={
                trimmedQuery.length > 0
                  ? t('houses.clearSearch', 'Clear search')
                  : t('houses.emptyCreateCta', 'Create a house')
              }
              onAction={trimmedQuery.length > 0 ? handleClearSearch : handleCreate}
            />
          }
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + FAB_BOTTOM_OFFSET + spacing.giant },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}

      <Animated.View
        style={[fab.animatedStyle, styles.fab, { bottom: insets.bottom + FAB_BOTTOM_OFFSET }]}
      >
        <Pressable
          onPress={handleCreate}
          onPressIn={fab.onPressIn}
          onPressOut={fab.onPressOut}
          accessibilityRole="button"
          accessibilityLabel={t('houses.createA11y', 'Create a new house')}
          className="w-16 h-16 rounded-pill bg-primary items-center justify-center shadow-glow-primary"
        >
          <MaterialIcons name="add" size={28} color={colors.onPrimary} />
        </Pressable>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  // flexGrow lets the centered EmptyState fill the viewport when the list is empty.
  list: { paddingHorizontal: spacing.xxl, flexGrow: 1 },
  fab: { position: 'absolute', right: spacing.xxl },
});
