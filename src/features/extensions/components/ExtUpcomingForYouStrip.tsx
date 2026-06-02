import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useExtUpcoming } from '../hooks/useUpcoming';
import type { UpcomingEvent } from '../api/upcomingApi';
import { colors } from '../../../shared/constants/theme';

interface Props {
  onSelect?: (event: UpcomingEvent) => void;
  emptyHint?: string;
}

/**
 * Horizontal "Upcoming for you" strip (Module 3.2 / HALL-006). Mount above
 * the room feed in the Hall — existing RoomFeedScreen is not modified, the
 * caller decides where to render this strip.
 */
export const ExtUpcomingForYouStrip: React.FC<Props> = ({ onSelect, emptyHint }) => {
  const { data, isLoading } = useExtUpcoming();
  if (isLoading) return null;
  if (!data || data.length === 0) {
    return emptyHint ? (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{emptyHint}</Text>
      </View>
    ) : null;
  }
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Upcoming for you</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={data}
        keyExtractor={e => e.id}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => onSelect?.(item)}
            accessibilityRole="button"
            accessibilityLabel={`Upcoming event ${item.title}`}
          >
            <Text style={styles.when}>{formatWhen(item.scheduledFor)}</Text>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            <View style={styles.hostRow}>
              {item.host.avatarUrl ? (
                <Image source={{ uri: item.host.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]} />
              )}
              <Text style={styles.host} numberOfLines={1}>
                {item.host.displayName ?? item.host.username}
              </Text>
            </View>
            <Text style={styles.rsvp}>
              {item.rsvpCount} interested
              {item.rsvpedByMe ? ' • You' : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
};

const formatWhen = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff < 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return d.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
};

const styles = StyleSheet.create({
  container: { paddingVertical: 8 },
  heading: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 8,
    color: colors.text,
  },
  row: { paddingHorizontal: 12, gap: 10 },
  card: {
    width: 220,
    padding: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassStrong,
  },
  when: { fontSize: 11, color: colors.primary, fontWeight: '600', marginBottom: 6 },
  title: { fontSize: 14, fontWeight: '600', color: colors.text },
  hostRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  avatar: { width: 22, height: 22, borderRadius: 11 },
  avatarFallback: { backgroundColor: colors.surfaceHigh },
  host: { fontSize: 12, color: colors.textMuted, flexShrink: 1 },
  rsvp: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  empty: { padding: 16 },
  emptyText: { color: colors.textDim, fontSize: 13 },
});
