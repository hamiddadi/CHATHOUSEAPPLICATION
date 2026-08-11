import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { User } from '../../../../shared/types/domain';
import {
  flattenFollowPages,
  useAcceptFollowRequest,
  useFollowRequests,
  useRejectFollowRequest,
} from '../../../profile/hooks/useProfile';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'FollowRequests'>;
type Decision = 'accept' | 'reject';

interface RequestRowProps {
  user: User;
  pendingDecision: Decision | null;
  onOpenProfile: (userId: string) => void;
  onDecision: (userId: string, decision: Decision) => void;
}

const RequestRow: React.FC<RequestRowProps> = memo(
  ({ user, pendingDecision, onOpenProfile, onDecision }) => {
    const { t } = useTranslation();
    return (
      <View className="gap-md rounded-md bg-overlay-white-5 p-lg">
        <Pressable
          onPress={() => onOpenProfile(user.id)}
          accessibilityRole="button"
          accessibilityLabel={t('notifications.followRequests.viewProfile', {
            name: user.displayName,
          })}
          className="flex-row items-center gap-md"
        >
          <Avatar uri={user.avatarUrl ?? undefined} name={user.displayName} size="md" />
          <View className="flex-1">
            <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
              {user.displayName}
            </Text>
            <Text className="text-xs font-body text-ink-muted" numberOfLines={1}>
              @{user.username}
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
        </Pressable>

        <View className="flex-row gap-sm">
          <View className="flex-1">
            <Button
              label={t('notifications.followRequests.reject')}
              accessibilityLabel={t('notifications.followRequests.rejectA11y', {
                name: user.displayName,
              })}
              variant="ghost"
              size="sm"
              fullWidth
              loading={pendingDecision === 'reject'}
              disabled={pendingDecision !== null}
              onPress={() => onDecision(user.id, 'reject')}
            />
          </View>
          <View className="flex-1">
            <Button
              label={t('notifications.followRequests.accept')}
              accessibilityLabel={t('notifications.followRequests.acceptA11y', {
                name: user.displayName,
              })}
              size="sm"
              fullWidth
              loading={pendingDecision === 'accept'}
              disabled={pendingDecision !== null}
              onPress={() => onDecision(user.id, 'accept')}
            />
          </View>
        </View>
      </View>
    );
  },
);
RequestRow.displayName = 'RequestRow';

export const FollowRequestsScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const requests = useFollowRequests();
  const accept = useAcceptFollowRequest();
  const reject = useRejectFollowRequest();
  const inFlightRef = useRef(new Set<string>());
  const [pendingDecisions, setPendingDecisions] = useState<Map<string, Decision>>(() => new Map());

  const items = useMemo(() => flattenFollowPages(requests.data), [requests.data]);
  const goBack = useCallback(() => navigation.goBack(), [navigation]);
  const openProfile = useCallback(
    (userId: string) => navigation.navigate('Profile', { userId }),
    [navigation],
  );

  const decide = useCallback(
    (userId: string, decision: Decision) => {
      // React can receive two taps before the mutation state re-renders. The
      // synchronous ref makes accept/reject mutually exclusive per requester.
      if (inFlightRef.current.has(userId)) return;
      inFlightRef.current.add(userId);
      setPendingDecisions(current => new Map(current).set(userId, decision));

      // `mutate` per-call callbacks are observer-scoped: with overlapping
      // calls, TanStack may only run the latest callback. Each request owns a
      // `mutateAsync` promise so its cleanup always executes independently.
      void (async () => {
        try {
          if (decision === 'accept') await accept.mutateAsync(userId);
          else await reject.mutateAsync(userId);
        } catch {
          Alert.alert(t('common.error'), t('notifications.followRequests.actionError'));
        } finally {
          inFlightRef.current.delete(userId);
          setPendingDecisions(current => {
            const next = new Map(current);
            next.delete(userId);
            return next;
          });
        }
      })();
    },
    [accept, reject, t],
  );

  const loadMore = useCallback(() => {
    if (requests.hasNextPage && !requests.isFetchingNextPage) {
      void requests.fetchNextPage();
    }
  }, [requests]);

  const renderItem = useCallback(
    ({ item }: { item: User }) => (
      <RequestRow
        user={item}
        pendingDecision={pendingDecisions.get(item.id) ?? null}
        onOpenProfile={openProfile}
        onDecision={decide}
      />
    ),
    [decide, openProfile, pendingDecisions],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={12}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-xl font-display text-ink flex-1">
          {t('notifications.followRequests.title')}
        </Text>
      </View>

      {requests.isLoading ? (
        <Loader fullscreen accessibilityLabel={t('notifications.followRequests.loading')} />
      ) : requests.isError ? (
        <EmptyState
          title={t('notifications.followRequests.errorTitle')}
          description={t('notifications.followRequests.errorBody')}
          actionLabel={t('common.retry')}
          onAction={() => void requests.refetch()}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={user => user.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View className="h-sm" />}
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingBottom: insets.bottom + spacing.giant,
          }}
          refreshControl={
            <RefreshControl
              refreshing={requests.isRefetching && !requests.isFetchingNextPage}
              onRefresh={() => void requests.refetch()}
              tintColor={colors.primary}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <EmptyState
              title={t('notifications.followRequests.emptyTitle')}
              description={t('notifications.followRequests.emptyBody')}
            />
          }
          ListFooterComponent={
            requests.isFetchingNextPage ? (
              <View className="py-lg items-center">
                <ActivityIndicator
                  color={colors.primary}
                  accessibilityLabel={t('common.loadingMore')}
                />
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};
