import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
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
import { useCreateGroup } from '../../hooks/useGroups';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'NewMessage'>;

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 20;

/**
 * Pick one or more people to message. Selecting exactly one opens a 1:1 thread
 * (a "conversation id" is just the peer's user id — see messageService);
 * selecting two or more creates a group conversation and opens it. We `replace`
 * so Back returns to the conversation list rather than this picker.
 */
export const NewMessageScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const createGroup = useCreateGroup();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<SearchUserHit[]>([]);
  const [searching, setSearching] = useState(false);
  // Selected peers, keyed by id so toggling is O(1) and order-stable enough.
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

  const selectedCount = selected.size;

  const handleStart = useCallback(() => {
    const ids = [...selected.keys()];
    const first = ids[0];
    if (ids.length === 1 && first) {
      navigation.replace('ChatDetail', { conversationId: first });
      return;
    }
    if (ids.length >= 2) {
      createGroup.mutate(
        { memberIds: ids },
        {
          onSuccess: group => navigation.replace('GroupChat', { conversationId: group.id }),
          onError: () =>
            Alert.alert(t('messages.groupError', 'Impossible de créer le groupe. Réessaie.')),
        },
      );
    }
  }, [createGroup, navigation, selected, t]);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);

  const startLabel = useMemo(() => {
    if (selectedCount >= 2)
      return t('messages.createGroupN', {
        count: selectedCount,
        defaultValue: `Create group · ${selectedCount}`,
      });
    return t('messages.message', 'Message');
  }, [selectedCount, t]);

  const renderItem = useCallback(
    ({ item }: { item: SearchUserHit }) => {
      const isSelected = selected.has(item.id);
      return (
        <Pressable
          onPress={() => toggle(item)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={`${item.displayName || item.username}`}
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

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
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
              title={t('messages.newMessageTitle', 'New message')}
              description={t(
                'messages.searchGroupHint',
                'Search for people. Pick one for a direct message, or several to start a group.',
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
            label={startLabel}
            variant="primary"
            size="lg"
            fullWidth
            loading={createGroup.isPending}
            disabled={createGroup.isPending}
            onPress={handleStart}
          />
        </View>
      )}
    </View>
  );
};
