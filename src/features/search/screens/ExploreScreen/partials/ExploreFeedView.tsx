import React from 'react';
import { FlatList, View } from 'react-native';
import type { TFunction } from 'i18next';
import { spacing } from '../../../../../shared/constants/theme';
import type { ExploreFeed } from '../../../services/exploreService';
import { ClubRow, RoomRow, Section, UserRow } from './rows';

interface ExploreFeedViewProps {
  data: ExploreFeed | undefined;
  bottomInset: number;
  isFetching: boolean;
  onRefresh: () => void;
  goUser: (id: string) => void;
  goClub: (id: string) => void;
  goRoom: (id: string) => void;
  t: TFunction;
}

export const ExploreFeedView: React.FC<ExploreFeedViewProps> = ({
  data,
  bottomInset,
  isFetching,
  onRefresh,
  goUser,
  goClub,
  goRoom,
  t,
}) => (
  <FlatList
    data={[0] as const}
    keyExtractor={() => 'sections'}
    contentContainerStyle={{
      paddingBottom: bottomInset + spacing.huge,
      paddingHorizontal: spacing.xxl,
    }}
    renderItem={() => (
      <View className="gap-xxl">
        <Section
          title={t('explore.trendingRooms')}
          empty={t('explore.emptyRooms')}
          items={data?.rooms}
          render={r => <RoomRow key={r.id} room={r} onPress={goRoom} />}
        />
        <Section
          title={t('explore.popularClubs')}
          empty={t('explore.emptyClubs')}
          items={data?.clubs}
          render={c => <ClubRow key={c.id} club={c} onPress={goClub} />}
        />
        <Section
          title={t('explore.peopleToFollow')}
          empty={t('explore.emptyUsers')}
          items={data?.users}
          render={u => <UserRow key={u.id} user={u} onPress={goUser} />}
        />
      </View>
    )}
    refreshing={isFetching}
    onRefresh={onRefresh}
    showsVerticalScrollIndicator={false}
  />
);
