import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExtSuggestions } from '../hooks/useSuggestions';
import type { SuggestedUser } from '../api/suggestionsApi';

interface Props {
  onTapUser?: (user: SuggestedUser) => void;
  onFollow?: (user: SuggestedUser) => Promise<void> | void;
}

/**
 * "People you may want to follow" screen — typically presented right after
 * interest selection (Module 1.5). Reachable via deep-link
 * `chathouse://r/ext/suggested-follows` so the existing navigator stays
 * untouched.
 */
export const ExtSuggestedFollowsScreen: React.FC<Props> = ({ onTapUser, onFollow }) => {
  const { data, isLoading, refetch, isRefetching } = useExtSuggestions(30);
  // Track who we've already followed so a second tap can't fire a duplicate
  // follow and the button reflects the new state.
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  const handleFollow = useCallback(
    (user: SuggestedUser) => {
      if (followed.has(user.id)) return;
      setFollowed(prev => new Set(prev).add(user.id));
      void Promise.resolve(onFollow?.(user)).catch(() => {
        // Roll back on failure so the user can retry.
        setFollowed(prev => {
          const next = new Set(prev);
          next.delete(user.id);
          return next;
        });
      });
    },
    [followed, onFollow],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>People you may know</Text>
        <Text style={styles.subtitle}>Based on your interests and people you follow.</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={u => u.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => onTapUser?.(item)}
              accessibilityRole="button"
              accessibilityLabel={`View profile of ${item.displayName ?? item.username}`}
            >
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarFallbackText}>
                    {(item.displayName ?? item.username ?? '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.displayName ?? item.username}
                </Text>
                {item.bio ? (
                  <Text style={styles.bio} numberOfLines={2}>
                    {item.bio}
                  </Text>
                ) : null}
                <Text style={styles.reason}>{reasonLabel(item)}</Text>
              </View>
              <Pressable
                style={[styles.followBtn, followed.has(item.id) && styles.followBtnDone]}
                onPress={() => handleFollow(item)}
                disabled={followed.has(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: followed.has(item.id) }}
                accessibilityLabel={`Follow ${item.displayName ?? item.username}`}
              >
                <Text style={styles.followBtnText}>
                  {followed.has(item.id) ? 'Following' : 'Follow'}
                </Text>
              </Pressable>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No suggestions yet. Come back later.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const reasonLabel = (u: SuggestedUser): string => {
  if (u.reason === 'shared_interests' && u.sharedInterestsCount > 0) {
    return `${u.sharedInterestsCount} shared interest${u.sharedInterestsCount > 1 ? 's' : ''}`;
  }
  if (u.reason === 'friends_of_friends') return 'Followed by people you follow';
  return `${u.followerCount.toLocaleString()} followers`;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 14, color: '#475569', marginTop: 2 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: { backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: '#475569', fontWeight: '600', fontSize: 20 },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  bio: { fontSize: 13, color: '#64748B', marginTop: 1 },
  reason: { fontSize: 11, color: '#2A8BF2', marginTop: 4 },
  followBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1F2937',
  },
  followBtnDone: { backgroundColor: '#94A3B8' },
  followBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  empty: { marginTop: 48, alignItems: 'center' },
  emptyText: { color: '#94A3B8' },
  loader: { marginTop: 32 },
});
