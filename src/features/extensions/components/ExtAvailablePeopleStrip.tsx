import React from 'react';
import { FlatList, Image, Pressable, Text, View, StyleSheet } from 'react-native';
import { useExtAvailablePeople } from '../hooks/usePresence';
import type { AvailableUser } from '../api/presenceApi';

interface Props {
  onWaveUser: (user: AvailableUser) => void;
}

/**
 * Horizontal "People available to chat" strip that the Hall can mount above
 * the room feed. Existing RoomFeedScreen is not modified — consumers opt in
 * by rendering <ExtAvailablePeopleStrip /> wherever they wish.
 */
export const ExtAvailablePeopleStrip: React.FC<Props> = ({ onWaveUser }) => {
  const { data, isLoading } = useExtAvailablePeople(20);

  if (isLoading || !data || data.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>People available to chat</Text>
      <FlatList
        horizontal
        data={data}
        keyExtractor={u => u.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onWaveUser(item)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Wave to ${item.displayName ?? item.username}`}
          >
            <View style={styles.avatarWrap}>
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarFallbackText}>
                    {(item.displayName ?? item.username ?? '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              {item.isOnline ? <View style={styles.onlineDot} /> : null}
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {item.displayName ?? item.username}
            </Text>
            <Text style={styles.wave}>👋 Wave</Text>
          </Pressable>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingVertical: 12 },
  title: { fontSize: 14, fontWeight: '600', paddingHorizontal: 16, marginBottom: 8 },
  row: { paddingHorizontal: 12, gap: 12 },
  card: { width: 84, alignItems: 'center' },
  avatarWrap: { position: 'relative' },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: { backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontSize: 22, color: '#475569', fontWeight: '600' },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  name: { fontSize: 12, marginTop: 6, maxWidth: 80 },
  wave: { fontSize: 11, color: '#2A8BF2', marginTop: 2 },
});
