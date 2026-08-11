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
import { useNavigation } from '@react-navigation/native';
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
import { useCreateGroup } from '../../hooks/useGroups';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'NewMessage'>;

/**
 * Pick one or more people to message. The candidate set is restricted to the
 * people you follow. Each row also carries a server-computed
 * `canDirectMessage` flag, which accounts for the recipient's private DM
 * setting, reciprocal follows and blocks without revealing which rule applied.
 * This prevents opening a new 1:1 thread that can only fail with CHAT_004.
 *
 * Selecting exactly one opens a 1:1 thread (a "conversation id" is just the
 * peer's user id — see messageService); selecting two or more creates a group
 * conversation and opens it. We `replace` so Back returns to the conversation
 * list rather than this picker.
 */
export const NewMessageScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const createGroup = useCreateGroup();
  const myId = useAuthStore(s => s.user?.id) ?? '';

  // Who I follow, paged server-side (limit 50/page). The infinite query fetches
  // the next page on scroll so a follow past the 50th isn't unreachable. A local
  // filter narrows the loaded rows as the user types — no per-keystroke call.
  const followingQuery = useFollowing(myId);
  const { isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = followingQuery;
  const following = useMemo(() => flattenFollowPages(followingQuery.data), [followingQuery.data]);

  const [query, setQuery] = useState('');
  // Selected peers, keyed by id so toggling is O(1) and order-stable enough.
  const [selected, setSelected] = useState<Map<string, User>>(new Map());
  const groupCreationInFlightRef = useRef(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return following;
    return following.filter(
      u => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    );
  }, [following, query]);

  const toggle = useCallback((hit: User) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(hit.id)) next.delete(hit.id);
      else next.set(hit.id, hit);
      return next;
    });
  }, []);

  const selectedPeople = useMemo(() => [...selected.values()], [selected]);
  const selectedCount = selected.size;
  const directMessageUnavailable =
    selectedCount === 1 && selectedPeople[0]?.canDirectMessage === false;

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleStart = useCallback(async () => {
    const ids = [...selected.keys()];
    const first = ids[0];
    if (ids.length === 1 && first) {
      // The disabled CTA is the primary guard; keep this defensive check so an
      // accessibility/programmatic press cannot navigate into a known-denied
      // thread. The send-time backend policy remains authoritative.
      if (selected.get(first)?.canDirectMessage === false) return;
      navigation.replace('ChatDetail', { conversationId: first });
      return;
    }
    if (ids.length >= 2) {
      if (groupCreationInFlightRef.current) return;
      groupCreationInFlightRef.current = true;
      try {
        const group = await createGroup.mutateAsync({ memberIds: ids });
        navigation.replace('GroupChat', { conversationId: group.id });
      } catch {
        Alert.alert(t('messages.groupError', 'Impossible de créer le groupe. Réessaie.'));
      } finally {
        groupCreationInFlightRef.current = false;
      }
    }
  }, [createGroup, navigation, selected, t]);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const startLabel = useMemo(() => {
    if (selectedCount >= 2)
      return t('messages.createGroupN', {
        count: selectedCount,
        defaultValue: `Create group · ${selectedCount}`,
      });
    if (directMessageUnavailable)
      return t('messages.messageUnavailable', 'Direct message unavailable');
    return t('messages.message', 'Message');
  }, [directMessageUnavailable, selectedCount, t]);

  const renderItem = useCallback(
    ({ item }: { item: User }) => {
      const isSelected = selected.has(item.id);
      const isDirectMessageUnavailable = item.canDirectMessage === false;
      return (
        <Pressable
          onPress={() => toggle(item)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={`${item.displayName || item.username}`}
          accessibilityHint={
            isDirectMessageUnavailable
              ? t(
                  'messages.messageUnavailableHint',
                  'This person cannot receive a direct message from you right now.',
                )
              : undefined
          }
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
            {isDirectMessageUnavailable && (
              <Text className="text-xs font-body-medium text-danger mt-xxs" numberOfLines={1}>
                {t('messages.messageUnavailable', 'Direct message unavailable')}
              </Text>
            )}
          </View>
          <MaterialIcons
            name={isSelected ? 'check-circle' : 'radio-button-unchecked'}
            size={24}
            color={isSelected ? colors.primary : colors.textMuted}
          />
        </Pressable>
      );
    },
    [selected, t, toggle],
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

  const hasFollowing = following.length > 0;

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
          {t('messages.newMessageTitle', 'New message')}
        </Text>
      </View>

      {hasFollowing && (
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
            {t(
              'messages.followGateHint',
              'Direct messages depend on each person’s privacy settings.',
            )}
          </Text>
        </View>
      )}

      <SelectedPeopleChips people={selectedPeople} onRemove={toggle} />

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading', 'Loading')} />
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
            !hasFollowing ? (
              <EmptyState
                title={t('messages.noFollowing', 'No one to message yet')}
                description={t(
                  'messages.noFollowingHint',
                  'Follow people to start messaging them.',
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
          {directMessageUnavailable && (
            <Text
              className="text-xs font-body text-danger text-center mb-sm"
              accessibilityLiveRegion="polite"
            >
              {t(
                'messages.messageUnavailableHint',
                'This person cannot receive a direct message from you right now.',
              )}
            </Text>
          )}
          <Button
            label={startLabel}
            variant="primary"
            size="lg"
            fullWidth
            loading={createGroup.isPending}
            disabled={createGroup.isPending || directMessageUnavailable}
            onPress={handleStart}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
};
