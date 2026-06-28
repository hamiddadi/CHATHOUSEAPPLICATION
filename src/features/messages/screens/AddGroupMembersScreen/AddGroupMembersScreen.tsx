import React, { useCallback, useMemo, useState } from 'react';
import {
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
import { useFollowing } from '../../../profile/hooks/useProfile';
import { useAddGroupMembers, useGroup } from '../../hooks/useGroups';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'AddGroupMembers'>;
type Route = RouteProp<MessageStackParamList, 'AddGroupMembers'>;

/**
 * Add people to an existing group. Candidates are restricted to the people you
 * follow (same DM follow-gate as a 1:1 — see NewMessageScreen / chatService),
 * minus the members already in the group. The old global user search let you
 * pick anyone, which the backend would then silently reject.
 */
export const AddGroupMembersScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const conversationId = route.params.conversationId;
  const myId = useAuthStore(s => s.user?.id) ?? '';

  const { data: group } = useGroup(conversationId);
  const { data: following, isLoading } = useFollowing(myId);
  const addMembers = useAddGroupMembers();
  // Existing members can't be re-added — drop them from the candidate list.
  const existingIds = useMemo(
    () => new Set((group?.members ?? []).map(m => m.id)),
    [group?.members],
  );

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, User>>(new Map());

  // People I follow who aren't already in the group, narrowed by the filter.
  const candidates = useMemo(
    () => (following ?? []).filter(u => !existingIds.has(u.id)),
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

  const handleAdd = useCallback(() => {
    const userIds = [...selected.keys()];
    if (userIds.length === 0) return;
    addMembers.mutate(
      { conversationId, userIds },
      {
        onSuccess: () => navigation.goBack(),
        onError: () => Alert.alert(t('messages.addError', "Couldn't add members. Try again.")),
      },
    );
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
