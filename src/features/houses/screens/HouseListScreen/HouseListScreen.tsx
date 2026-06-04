import React, { memo, useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { useAnimatedPress } from '../../../../shared/hooks/useAnimatedPress';
import { colors, layout, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { HouseSummary } from '../../../../shared/types/domain';
import { useHouses } from '../../hooks/useHouses';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'HouseList'>;
type Tab = 'mine' | 'discover';

const FAB_BOTTOM_OFFSET = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.xl;
const HOUSE_ICON_SIZE = 56;

interface HouseRowProps {
  house: HouseSummary;
  onPress: (id: string) => void;
}

const HouseRow: React.FC<HouseRowProps> = memo(({ house, onPress }) => {
  const press = useAnimatedPress({ scaleTo: 0.98 });
  const handle = useCallback(() => onPress(house.id), [house.id, onPress]);
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={handle}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`Open house ${house.name}`}
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
            <Text className="text-xs font-body-medium text-ink-muted">
              {house.categoryEmoji} {house.category}
            </Text>
            <Text className="text-ink-dim">•</Text>
            <Text className="text-xs font-body text-ink-muted">
              {house.membersCount.toLocaleString()} members
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
  const fab = useAnimatedPress({ scaleTo: 0.9 });
  const { data: houses, isLoading, isError, isFetching, refetch } = useHouses(tab);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleOpenHouse = useCallback(
    (houseId: string) => navigation.navigate('HouseDetail', { houseId }),
    [navigation],
  );
  const handleCreate = useCallback(() => navigation.navigate('CreateHouse'), [navigation]);

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
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-lg font-headline text-ink">{t('houses.title', 'Houses')}</Text>
        {/* Right-side spacer keeps the title centered. House search is not yet
            implemented — a dead search affordance was removed rather than
            shipping a button that does nothing. */}
        <View className="w-6" />
      </View>

      <View className="px-xxl mb-lg">
        <TabToggle value={tab} onChange={setTab} />
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('houses.loading', 'Loading houses')} />
      ) : isError ? (
        <EmptyState
          title={t('houses.errorTitle', "Couldn't load houses")}
          description={t('houses.errorBody', 'Check your connection.')}
        />
      ) : (
        <FlatList
          data={houses ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          refreshing={isFetching}
          onRefresh={() => void refetch()}
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
          accessibilityLabel="Create a new house"
          className="w-16 h-16 rounded-pill bg-primary items-center justify-center shadow-glow-primary"
        >
          <MaterialIcons name="add" size={28} color={colors.onPrimary} />
        </Pressable>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.xxl },
  fab: { position: 'absolute', right: spacing.xxl },
});
