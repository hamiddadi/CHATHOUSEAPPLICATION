import React from 'react';
import { ScrollView, View } from 'react-native';
import type { TFunction } from 'i18next';
import { EmptyState } from '../../../../../shared/components/EmptyState';
import { spacing } from '../../../../../shared/constants/theme';
import type { SearchResults } from '../../../services/searchService';
import { ClubRow, RoomRow, Section, UserRow } from './rows';

interface SearchResultsViewProps {
  data: SearchResults | undefined;
  debouncedQuery: string;
  bottomInset: number;
  goUser: (id: string) => void;
  goClub: (id: string) => void;
  goRoom: (id: string) => void;
  t: TFunction;
}

export const SearchResultsView: React.FC<SearchResultsViewProps> = ({
  data,
  debouncedQuery,
  bottomInset,
  goUser,
  goClub,
  goRoom,
  t,
}) => (
  <ScrollView
    contentContainerStyle={{
      paddingBottom: bottomInset + spacing.huge,
      paddingHorizontal: spacing.xxl,
    }}
  >
    {(data?.users.length ?? 0) + (data?.clubs.length ?? 0) + (data?.rooms.length ?? 0) === 0 ? (
      <EmptyState title={t('explore.searchEmpty', { q: debouncedQuery })} description="" />
    ) : (
      <View className="gap-xxl">
        <Section
          title={t('explore.peopleToFollow')}
          items={data?.users}
          render={u => <UserRow key={u.id} user={u} onPress={goUser} />}
        />
        <Section
          title={t('explore.popularClubs')}
          items={data?.clubs}
          render={c => <ClubRow key={c.id} club={c} onPress={goClub} />}
        />
        <Section
          title={t('explore.trendingRooms')}
          items={data?.rooms}
          render={r => <RoomRow key={r.id} room={r} onPress={goRoom} />}
        />
      </View>
    )}
  </ScrollView>
);
