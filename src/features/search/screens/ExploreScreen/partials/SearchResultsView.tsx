import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { TFunction } from 'i18next';
import { EmptyState } from '../../../../../shared/components/EmptyState';
import { spacing } from '../../../../../shared/constants/theme';
import type { SearchResults } from '../../../services/searchService';
import type { FlatTopic } from '../../../../extensions/api/topicsApi';
import { ClubRow, RoomRow, Section, UserRow } from './rows';

interface SearchResultsViewProps {
  data: SearchResults | undefined;
  topics?: FlatTopic[];
  debouncedQuery: string;
  bottomInset: number;
  goUser: (id: string) => void;
  goClub: (id: string) => void;
  goRoom: (id: string) => void;
  goTopic: (slug: string) => void;
  t: TFunction;
}

export const SearchResultsView: React.FC<SearchResultsViewProps> = ({
  data,
  topics,
  debouncedQuery,
  bottomInset,
  goUser,
  goClub,
  goRoom,
  goTopic,
  t,
}) => {
  const total =
    (data?.users.length ?? 0) +
    (data?.clubs.length ?? 0) +
    (data?.rooms.length ?? 0) +
    (topics?.length ?? 0);
  return (
    <ScrollView
      contentContainerStyle={{
        paddingBottom: bottomInset + spacing.huge,
        paddingHorizontal: spacing.xxl,
      }}
    >
      {total === 0 ? (
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
          {topics && topics.length > 0 ? (
            <Section
              title={t('explore.topics', 'Topics')}
              items={topics}
              render={tp => (
                <Pressable
                  key={tp.slug}
                  onPress={() => goTopic(tp.slug)}
                  accessibilityRole="button"
                  className="flex-row items-center gap-md py-md"
                >
                  <Text className="text-lg">{tp.emoji}</Text>
                  <Text className="text-md font-body-medium text-ink flex-1" numberOfLines={1}>
                    {tp.label}
                  </Text>
                </Pressable>
              )}
            />
          ) : null}
        </View>
      )}
    </ScrollView>
  );
};
