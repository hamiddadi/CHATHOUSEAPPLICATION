import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useExtRecentlyPlayed } from '../hooks/useUpcoming';
import { colors } from '../../../shared/constants/theme';

interface Props {
  onSelect?: (roomId: string) => void;
}

/**
 * Horizontal "Recently played" strip (resume parity). Lists rooms the viewer
 * recently opened (backed by the recently-played zset), with a live/ended
 * indicator on each card. Mounted by the caller (RoomFeedScreen) above the
 * room feed; renders nothing while loading or when the history is empty.
 */
export const ExtRecentlyPlayedStrip: React.FC<Props> = ({ onSelect }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useExtRecentlyPlayed();
  if (isLoading) return null;
  if (!data || data.length === 0) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t('feed.recentlyPlayed', 'Recently played')}</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={data}
        keyExtractor={r => r.id}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => onSelect?.(item.id)}
            accessibilityRole="button"
            accessibilityLabel={t('feed.resumeRoomA11y', 'Resume room {{title}}', {
              title: item.title,
            })}
          >
            <View style={styles.statusRow}>
              <View
                style={[styles.dot, item.isLive ? styles.dotLive : styles.dotEnded]}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={[styles.status, item.isLive ? styles.statusLive : styles.statusEnded]}>
                {item.isLive ? t('feed.liveNow', 'Live Now') : t('feed.ended', 'Ended')}
              </Text>
            </View>
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
                {item.host.displayName ?? item.host.username ?? ''}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  dotLive: { backgroundColor: colors.primary },
  dotEnded: { backgroundColor: colors.textDim },
  status: { fontSize: 11, fontWeight: '600' },
  statusLive: { color: colors.primary },
  statusEnded: { color: colors.textMuted },
  title: { fontSize: 14, fontWeight: '600', color: colors.text },
  hostRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 },
  avatar: { width: 22, height: 22, borderRadius: 11 },
  avatarFallback: { backgroundColor: colors.surfaceHigh },
  host: { fontSize: 12, color: colors.textMuted, flexShrink: 1 },
});
