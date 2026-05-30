import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { badgesApi, BADGE_META, type Badge } from '../api/badgesApi';

interface Props {
  userId: string;
  /** When true, only the emoji is shown (compact mode for tight headers). */
  compact?: boolean;
  /** Cap on number of badges rendered. */
  max?: number;
}

/**
 * Inline row of badges to render next to a user's display name on profile,
 * room cards, chat header, etc. (Module 2.1 / PROFIL-001/028).
 *
 * Caller passes the userId; the hook fetches once and caches in
 * component-local state. For higher-traffic surfaces, wrap in React Query
 * via a separate hook if needed — this stays minimal here.
 */
export const ExtBadgesRow: React.FC<Props> = ({ userId, compact = false, max = 4 }) => {
  const [items, setItems] = useState<Badge[]>([]);

  useEffect(() => {
    let cancelled = false;
    badgesApi
      .list(userId)
      .then(b => {
        if (!cancelled) setItems(b);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (items.length === 0) return null;
  const visible = items.slice(0, max);

  return (
    <View style={[styles.row, compact && styles.rowCompact]} accessibilityRole="text">
      {visible.map(b => {
        const meta = BADGE_META[b];
        return (
          <View
            key={b}
            style={[styles.chip, { backgroundColor: meta.tone }]}
            accessibilityLabel={meta.label}
          >
            <Text style={styles.emoji}>{meta.emoji}</Text>
            {!compact ? <Text style={styles.label}>{meta.label}</Text> : null}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rowCompact: { gap: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 4,
  },
  emoji: { fontSize: 12, color: '#FFFFFF' },
  label: { fontSize: 11, color: '#FFFFFF', fontWeight: '600' },
});
