import React, { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useExtSuggestions } from '../hooks/useSuggestions';
import { apiClient } from '../../../shared/services/api/apiClient';
import { initialOf } from '../utils/extUi';
import { colors } from '../../../shared/constants/theme';

/**
 * Horizontal "Suggestions à suivre" strip for the Hallway feed. Self-contained:
 * pulls interest/FoF/trending suggestions from /ext/suggestions and follows in
 * place (the card drops out once followed). RoomFeedScreen just mounts it.
 */
export const ExtSuggestedFollowsStrip: React.FC = () => {
  const { data } = useExtSuggestions(20);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const follow = useMutation({
    mutationFn: (userId: string) => apiClient.post(`/follow/${userId}`),
  });

  const handleFollow = useCallback(
    (userId: string) => {
      setFollowed(prev => new Set(prev).add(userId));
      follow.mutate(userId);
    },
    [follow],
  );

  const items = (data ?? []).filter(u => !followed.has(u.id));
  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Suggestions à suivre</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={u => u.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => (
          <View style={styles.card}>
            {item.avatarUrl ? (
              <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarFallbackText}>
                  {initialOf(item.displayName ?? item.username ?? '?')}
                </Text>
              </View>
            )}
            <Text style={styles.name} numberOfLines={1}>
              {item.displayName ?? item.username}
            </Text>
            <Pressable
              onPress={() => handleFollow(item.id)}
              style={styles.followBtn}
              accessibilityRole="button"
              accessibilityLabel={`Suivre ${item.displayName ?? item.username}`}
            >
              <Text style={styles.followText}>+ Suivre</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingVertical: 12 },
  title: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 8,
    color: colors.text,
  },
  row: { paddingHorizontal: 12, gap: 12 },
  card: { width: 84, alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: {
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: { fontSize: 22, color: colors.textMuted, fontWeight: '600' },
  name: { fontSize: 12, marginTop: 6, maxWidth: 80, color: colors.text },
  followBtn: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 9999,
    backgroundColor: colors.primary,
  },
  followText: { fontSize: 11, color: colors.background, fontWeight: '600' },
});
