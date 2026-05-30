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
import { useExtTopicsTree, useExtTopicsFlat, type Topic } from '../hooks/useTopics';

interface Props {
  onSelectTopic?: (slug: string) => void;
}

/**
 * 150+ topics explorer (Module 11/13.5). Two-pane navigation: top-level
 * categories on the left, sub-categories on the right. A search bar
 * fuzz-matches across the flat list.
 */
export const ExtTopicExplorerScreen: React.FC<Props> = ({ onSelectTopic }) => {
  const [query, setQuery] = useState('');
  const [activeParent, setActiveParent] = useState<string | null>(null);

  const tree = useExtTopicsTree();
  const flat = useExtTopicsFlat(query.trim() || undefined);

  const isSearching = query.trim().length > 0;

  const activeChildren = useMemo<Topic[]>(() => {
    if (!tree.data) return [];
    const top = tree.data.topics.find(t => t.slug === activeParent);
    return top?.children ?? [];
  }, [tree.data, activeParent]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Explore topics</Text>
        <TextInput
          style={styles.search}
          placeholder="Search topics…"
          placeholderTextColor="#94A3B8"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search topics"
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
              accessibilityLabel={`Select topic ${item.label}`}
            >
              <Text style={styles.emoji}>{item.emoji}</Text>
              <Text style={styles.flatLabel}>{item.label}</Text>
            </Pressable>
          )}
        />
      ) : (
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
                accessibilityLabel={`Select sub-topic ${item.label}`}
              >
                <Text style={styles.emoji}>{item.emoji}</Text>
                <Text style={styles.childLabel}>{item.label}</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Pick a category on the left.</Text>
              </View>
            }
          />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  search: {
    marginTop: 8,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    color: '#0F172A',
  },
  twoPane: { flex: 1, flexDirection: 'row' },
  leftPane: { flexBasis: 140, borderRightWidth: StyleSheet.hairlineWidth, borderColor: '#E2E8F0' },
  rightPane: { flex: 1 },
  parentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  parentRowActive: { backgroundColor: '#F8FAFC' },
  parentLabel: { fontSize: 13, color: '#475569' },
  parentLabelActive: { color: '#0F172A', fontWeight: '600' },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#F1F5F9',
  },
  childLabel: { fontSize: 15, color: '#0F172A' },
  flatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#F1F5F9',
  },
  flatLabel: { fontSize: 15, color: '#0F172A' },
  emoji: { fontSize: 18 },
  empty: { padding: 24 },
  emptyText: { color: '#94A3B8' },
  loader: { marginTop: 32 },
});
