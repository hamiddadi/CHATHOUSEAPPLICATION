import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  useExtTopicsTree,
  useExtTopicsFlat,
  useExtTopicsTrending,
  type Topic,
} from '../hooks/useTopics';
import { colors } from '../../../shared/constants/theme';

interface Props {
  onSelectTopic?: (slug: string) => void;
}

/**
 * 150+ topics explorer (Module 11/13.5). Two-pane navigation: top-level
 * categories on the left, sub-categories on the right. A search bar
 * fuzz-matches across the flat list.
 */
export const ExtTopicExplorerScreen: React.FC<Props> = ({ onSelectTopic }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeParent, setActiveParent] = useState<string | null>(null);

  const tree = useExtTopicsTree();
  const flat = useExtTopicsFlat(query.trim() || undefined);
  const trending = useExtTopicsTrending();

  const isSearching = query.trim().length > 0;

  const activeChildren = useMemo<Topic[]>(() => {
    if (!tree.data) return [];
    const top = tree.data.topics.find(t => t.slug === activeParent);
    return top?.children ?? [];
  }, [tree.data, activeParent]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('extensions.topics.title', 'Explore topics')}</Text>
        <TextInput
          style={styles.search}
          placeholder={t('extensions.topics.searchPlaceholder', 'Search topics…')}
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={t('extensions.topics.searchA11y', 'Search topics')}
        />
      </View>

      {tree.isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : isSearching ? (
        <FlatList
          data={flat.data ?? []}
          keyExtractor={t => t.slug}
          renderItem={({ item }) => (
            <Pressable
              style={styles.flatRow}
              onPress={() => onSelectTopic?.(item.slug)}
              accessibilityRole="button"
              accessibilityLabel={t('extensions.topics.selectTopicA11y', 'Select topic {{label}}', {
                label: item.label,
              })}
            >
              <Text style={styles.emoji}>{item.emoji}</Text>
              <Text style={styles.flatLabel}>{item.label}</Text>
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.defaultPane}>
          {trending.data && trending.data.length > 0 ? (
            <View style={styles.trendingWrap}>
              <Text style={styles.trendingTitle}>
                {t('extensions.topics.trending', 'Tendances')}
              </Text>
              <FlatList
                horizontal
                data={trending.data}
                keyExtractor={tp => tp.slug}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.trendingRow}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.trendingChip}
                    onPress={() => onSelectTopic?.(item.slug)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label} (${item.count})`}
                  >
                    <Text style={styles.emoji}>{item.emoji}</Text>
                    <Text style={styles.trendingLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.trendingCount}>{item.count}</Text>
                  </Pressable>
                )}
              />
            </View>
          ) : null}
          <View style={styles.twoPane}>
            <FlatList
              style={styles.leftPane}
              data={tree.data?.topics ?? []}
              keyExtractor={t => t.slug}
              renderItem={({ item }) => {
                const active = item.slug === activeParent;
                return (
                  <Pressable
                    style={[styles.parentRow, active && styles.parentRowActive]}
                    onPress={() => setActiveParent(item.slug)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={styles.emoji}>{item.emoji}</Text>
                    <Text style={[styles.parentLabel, active && styles.parentLabelActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
            />
            <FlatList
              style={styles.rightPane}
              data={activeChildren}
              keyExtractor={t => t.slug}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.childRow}
                  onPress={() => onSelectTopic?.(item.slug)}
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    'extensions.topics.selectSubTopicA11y',
                    'Select sub-topic {{label}}',
                    { label: item.label },
                  )}
                >
                  <Text style={styles.emoji}>{item.emoji}</Text>
                  <Text style={styles.childLabel}>{item.label}</Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    {t('extensions.topics.empty', 'Pick a category on the left.')}
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  search: {
    marginTop: 8,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    color: colors.text,
  },
  defaultPane: { flex: 1 },
  twoPane: { flex: 1, flexDirection: 'row' },
  trendingWrap: { paddingTop: 8, paddingBottom: 4 },
  trendingTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  trendingRow: { paddingHorizontal: 12, gap: 8 },
  trendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: colors.surfaceHigh,
  },
  trendingLabel: { fontSize: 13, color: colors.text, maxWidth: 120 },
  trendingCount: { fontSize: 12, fontWeight: '700', color: colors.primary },
  leftPane: {
    flexBasis: 140,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
  },
  rightPane: { flex: 1 },
  parentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  parentRowActive: { backgroundColor: colors.overlayWhite5 },
  parentLabel: { fontSize: 13, color: colors.textMuted },
  parentLabelActive: { color: colors.text, fontWeight: '600' },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
  },
  childLabel: { fontSize: 15, color: colors.text },
  flatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
  },
  flatLabel: { fontSize: 15, color: colors.text },
  emoji: { fontSize: 18 },
  empty: { padding: 24 },
  emptyText: { color: colors.textDim },
  loader: { marginTop: 32 },
});
