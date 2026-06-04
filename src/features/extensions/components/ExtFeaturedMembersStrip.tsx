import React, { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { clubMetaApi, type ClubMeta } from '../api/clubMetaApi';
import { colors } from '../../../shared/constants/theme';

interface Props {
  clubId: string;
  onTapMember?: (userId: string) => void;
}

/**
 * Horizontal strip of featured members for a club (Module 10.7 / CLUB-004).
 * Consumes the Vague 14 `clubMetaApi`. Hidden when no member is featured.
 */
export const ExtFeaturedMembersStrip: React.FC<Props> = ({ clubId, onTapMember }) => {
  const [meta, setMeta] = useState<ClubMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    clubMetaApi
      .get(clubId)
      .then(m => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  if (!meta || meta.featuredMembers.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Featured members</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={meta.featuredMembers}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => onTapMember?.(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`View profile of ${item.displayName ?? item.username}`}
          >
            {item.avatarUrl ? (
              <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>
                  {(item.displayName ?? item.username ?? '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.name} numberOfLines={1}>
              {item.displayName ?? item.username ?? '—'}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingVertical: 10 },
  heading: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 8,
    color: colors.textMuted,
  },
  row: { paddingHorizontal: 12, gap: 12 },
  card: { width: 72, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textMuted, fontWeight: '700', fontSize: 20 },
  name: { fontSize: 11, marginTop: 6, color: colors.text, maxWidth: 70, textAlign: 'center' },
});
