import React, { useEffect, useMemo, useState } from 'react';
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
  /**
   * Pre-select a category on mount. Matched against a top-level slug directly,
   * or against the parent of a matching sub-topic slug, so a caller can deep
   * into either level. Purely an initial hint — the user can still navigate.
   */
  initialTopic?: string;
}

/**
 * 150+ topics explorer (Module 11/13.5). Two-pane navigation: top-level
 * categories on the left, sub-categories on the right. A search bar
 * fuzz-matches across the flat list.
 */
export const ExtTopicExplorerScreen: React.FC<Props> = ({ onSelectTopic, initialTopic }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeParent, setActiveParent] = useState<string | null>(null);

  const tree = useExtTopicsTree();
  const flat = useExtTopicsFlat(query.trim() || undefined);
  const trending = useExtTopicsTrending();

  const isSearching = query.trim().length > 0;

  // Resolve `initialTopic` to a top-level category once the tree has loaded.
  // Only seed the selection while none has been made yet, so a later user tap
  // is never clobbered by a re-run.
  useEffect(() => {
    if (!initialTopic || !tree.data || activeParent !== null) return;
    const topics = tree.data.topics;
    const asParent = topics.find(top => top.slug === initialTopic);
    const asChild = topics.find(top => top.children?.some(c => c.slug === initialTopic));
    const match = asParent ?? asChild;
    if (match) setActiveParent(match.slug);
  }, [initialTopic, tree.data, activeParent]);

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
      ) : tree.isError ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>
            {t('extensions.topics.error', "Couldn't load topics.")}
          </Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => void tree.refetch()}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry', 'Retry')}
          >
            <Text style={styles.retryText}>{t('common.retry', 'Retry')}</Text>
          </Pressable>
        </View>
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
                {t('extensions.topics.trending', 'Trending')}
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
                    hitSlop={8}
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
  errorWrap: { marginTop: 48, alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  errorText: { color: colors.textDim, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.primary,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryText: { color: colors.onPrimary, fontWeight: '600', fontSize: 13 },
});
