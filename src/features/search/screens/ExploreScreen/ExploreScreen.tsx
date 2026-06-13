import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { useDebouncedValue } from '../../../../shared/hooks/useDebouncedValue';
import { useExplore, useSearch } from '../../hooks/useSearch';
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

export const ExploreScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebouncedValue(rawQuery.trim(), DEBOUNCE_MS);

  const explore = useExplore();
  const search = useSearch(debouncedQuery);

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

  const isSearching = debouncedQuery.length > 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-xl font-display text-ink flex-1">{t('explore.title')}</Text>
      </View>

      <View className="px-xxl pb-md">
        <Input
          placeholder={t('explore.searchPlaceholder')}
          value={rawQuery}
          onChangeText={setRawQuery}
          autoCorrect={false}
          autoCapitalize="none"
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
        />
      </View>

      {isSearching ? (
        search.isLoading ? (
          <Loader fullscreen accessibilityLabel={t('explore.searchResults')} />
        ) : (
          <SearchResultsView
            data={search.data}
            debouncedQuery={debouncedQuery}
            bottomInset={insets.bottom}
            goUser={goUser}
            goClub={goClub}
            goRoom={goRoom}
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
