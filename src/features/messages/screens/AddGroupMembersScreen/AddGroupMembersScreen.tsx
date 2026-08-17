import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import type { User } from '../../../../shared/types/domain';
import { useAuthStore } from '../../../auth/store/authStore';
import { flattenFollowPages, useFollowing } from '../../../profile/hooks/useProfile';
import { SelectedPeopleChips } from '../../components/SelectedPeopleChips';
import { useAddGroupMembers, useGroup } from '../../hooks/useGroups';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'AddGroupMembers'>;
type Route = RouteProp<MessageStackParamList, 'AddGroupMembers'>;

/**
 * Add people to an existing group. Candidates are restricted to the people you
 * follow (mirrors NewMessageScreen's compose picker), minus the members already
 * in the group. The old global user search let you pick anyone, which the
 * backend would then reject.
 *
 * The server independently enforces both an ACCEPTED follow from the adder to
 * every candidate and a symmetric Block check across the full membership.
 * This picker mirrors that policy but is not the security boundary.
 */
export const AddGroupMembersScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const conversationId = route.params.conversationId;
  const myId = useAuthStore(s => s.user?.id) ?? '';

  const {
    data: group,
    isLoading: isGroupLoading,
    isError: isGroupError,
    refetch: refetchGroup,
  } = useGroup(conversationId);
  // Who I follow, paged server-side (limit 50/page); the infinite query pulls
  // the next page on scroll so followers past the 50th are still addable.
  const followingQuery = useFollowing(myId);
  const {
    isLoading: isFollowingLoading,
    isError: isFollowingError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch: refetchFollowing,
  } = followingQuery;
  const following = useMemo(() => flattenFollowPages(followingQuery.data), [followingQuery.data]);
  const addMembers = useAddGroupMembers();
  // Existing members can't be re-added — drop them from the candidate list.
  const existingIds = useMemo(
    () => new Set((group?.members ?? []).map(m => m.id)),
    [group?.members],
  );

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, User>>(new Map());
  const addInFlightRef = useRef(false);

  // People I follow who aren't already in the group, narrowed by the filter.
  const candidates = useMemo(
    () => following.filter(u => !existingIds.has(u.id)),
    [following, existingIds],
  );
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return candidates;
    return candidates.filter(
      u => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    );
  }, [candidates, query]);

  const toggle = useCallback((hit: User) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(hit.id)) next.delete(hit.id);
      else next.set(hit.id, hit);
      return next;
    });
  }, []);

  const selectedPeople = useMemo(() => [...selected.values()], [selected]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRetry = useCallback(() => {
    if (isGroupError) void refetchGroup();
    if (isFollowingError) void refetchFollowing();
  }, [isFollowingError, isGroupError, refetchFollowing, refetchGroup]);

  const handleAdd = useCallback(async () => {
    if (addInFlightRef.current) return;
    const userIds = [...selected.keys()];
    if (userIds.length === 0) return;
    addInFlightRef.current = true;
    try {
      await addMembers.mutateAsync({ conversationId, userIds });
      navigation.goBack();
    } catch {
      Alert.alert(t('messages.addError', "Couldn't add members. Try again."));
    } finally {
      addInFlightRef.current = false;
    }
  }, [addMembers, conversationId, navigation, selected, t]);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: User }) => {
      const isSelected = selected.has(item.id);
      return (
        <Pressable
          onPress={() => toggle(item)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={item.displayName || item.username}
          className="flex-row items-center gap-md px-xxl py-md active:opacity-70"
        >
          <Avatar uri={item.avatarUrl ?? undefined} name={item.displayName} size="lg" />
          <View className="flex-1">
            <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
              {item.displayName || item.username}
            </Text>
            <Text className="text-sm font-body text-ink-muted" numberOfLines={1}>
              @{item.username}
            </Text>
          </View>
          <MaterialIcons
            name={isSelected ? 'check-circle' : 'radio-button-unchecked'}
            size={24}
            color={isSelected ? colors.primary : colors.textMuted}
          />
        </Pressable>
      );
    },
    [selected, toggle],
  );

  const renderFooter = useCallback(
    () =>
      isFetchingNextPage ? (
        <View className="py-lg items-center">
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel={t('common.loadingMore', 'Loading more')}
          />
        </View>
      ) : null,
    [isFetchingNextPage, t],
  );

  const selectedCount = selected.size;
  const hasCandidates = candidates.length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center gap-md px-xxl py-lg">
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close', 'Close')}
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text className="text-xl font-display text-ink tracking-tight">
          {t('messages.addPeople', 'Add people')}
        </Text>
      </View>

      {hasCandidates && (
        <View className="px-xxl pb-md">
          <Input
            placeholder={t('messages.filterPeople', 'Filter people you follow')}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
          />
          <Text className="text-xs font-body text-ink-muted mt-xs">
            {t('messages.followGateAddHint', 'You can add people you follow.')}
          </Text>
        </View>
      )}

      <SelectedPeopleChips people={selectedPeople} onRemove={toggle} />

      {isGroupLoading || isFollowingLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading', 'Loading')} />
      ) : isGroupError || isFollowingError ? (
        <EmptyState
          title={t('messages.couldNotLoad', "Couldn't load messages")}
          description={t('messages.loadErrorHint', 'Check your connection and try again.')}
          actionLabel={t('common.retry', 'Retry')}
          onAction={handleRetry}
        />
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View className="h-px bg-overlay-white-5 ml-[76px]" />}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.giant }}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            !hasCandidates ? (
              <EmptyState
                title={t('messages.noFollowing', 'No one to message yet')}
                description={t(
                  'messages.noFollowingAddHint',
                  'Follow people to add them to a group.',
                )}
              />
            ) : (
              <EmptyState
                title={t('messages.noResults', 'No one found')}
                description={t('messages.noResultsHint', 'Try a different name or username.')}
              />
            )
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {selectedCount > 0 && (
        <View
          className="px-xxl pt-sm border-t border-overlay-white-5"
          style={{ paddingBottom: insets.bottom + spacing.md }}
        >
          <Button
            label={t('messages.addN', {
              count: selectedCount,
              defaultValue: `Add ${selectedCount}`,
            })}
            variant="primary"
            size="lg"
            fullWidth
            loading={addMembers.isPending}
            disabled={addMembers.isPending}
            onPress={handleAdd}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
};
