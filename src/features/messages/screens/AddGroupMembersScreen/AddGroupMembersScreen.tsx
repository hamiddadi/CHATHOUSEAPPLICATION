import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import { searchService, type SearchUserHit } from '../../../search/services/searchService';
import { useAddGroupMembers, useGroup } from '../../hooks/useGroups';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'AddGroupMembers'>;
type Route = RouteProp<MessageStackParamList, 'AddGroupMembers'>;

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 20;

/** Search users and add the selected ones to an existing group conversation. */
export const AddGroupMembersScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const conversationId = route.params.conversationId;

  const { data: group } = useGroup(conversationId);
  const addMembers = useAddGroupMembers();
  // Existing members can't be re-added — filter them out of results. Memoized
  // so it doesn't rebuild every render (which would churn renderItem's deps).
  const existingIds = useMemo(
    () => new Set((group?.members ?? []).map(m => m.id)),
    [group?.members],
  );

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<SearchUserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, SearchUserHit>>(new Map());

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (debounced.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void searchService
      .users(debounced, SEARCH_LIMIT)
      .then(rows => {
        if (!cancelled) setResults(rows);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const toggle = useCallback((hit: SearchUserHit) => {
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
    ({ item }: { item: SearchUserHit }) => {
      const alreadyMember = existingIds.has(item.id);
      const isSelected = selected.has(item.id);
      return (
        <Pressable
          onPress={() => !alreadyMember && toggle(item)}
          disabled={alreadyMember}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected, disabled: alreadyMember }}
          className={
            alreadyMember
              ? 'flex-row items-center gap-md px-xxl py-md opacity-40'
              : 'flex-row items-center gap-md px-xxl py-md active:opacity-70'
          }
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
            name={alreadyMember ? 'check' : isSelected ? 'check-circle' : 'radio-button-unchecked'}
            size={24}
            color={isSelected ? colors.primary : colors.textMuted}
          />
        </Pressable>
      );
    },
    [existingIds, selected, toggle],
  );

  const selectedCount = selected.size;

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

      <View className="px-xxl pb-md">
        <Input
          placeholder={t('messages.searchPeople', 'Search people')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
        />
      </View>

      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View className="h-px bg-overlay-white-5 ml-[76px]" />}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.giant }}
        ListEmptyComponent={
          debounced.length === 0 ? (
            <EmptyState
              title={t('messages.addPeople', 'Add people')}
              description={t(
                'messages.searchPeopleHint',
                'Search for people to add to this group.',
              )}
            />
          ) : searching ? null : (
            <EmptyState
              title={t('messages.noResults', 'No one found')}
              description={t('messages.noResultsHint', 'Try a different name or username.')}
            />
          )
        }
        showsVerticalScrollIndicator={false}
      />

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
