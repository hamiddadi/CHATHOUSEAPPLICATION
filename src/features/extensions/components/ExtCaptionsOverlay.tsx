import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CaptionLine } from '../hooks/useExtCaptions';

interface Props {
  lines: CaptionLine[];
  maxLines?: number;
}

/**
 * Floating captions overlay (Clubhouse-style). Renders the last few caption
 * lines as a single dimmed block at the bottom of the room screen.
 *
 * Caller decides when to mount (typically: only when
 * `useExtCaptions().enabled === true`).
 */
export const ExtCaptionsOverlay: React.FC<Props> = ({ lines, maxLines = 3 }) => {
  const visible = lines.slice(-maxLines);
  if (visible.length === 0) return null;

  return (
    <View
      style={styles.wrap}
      pointerEvents="none"
      accessibilityRole="text"
      accessibilityLabel="Live captions"
    >
      {visible.map(line => (
        <View key={line.id} style={styles.row}>
          {line.speakerName ? (
            <Text style={styles.speaker} numberOfLines={1}>
              {line.speakerName}:
            </Text>
          ) : null}
          <Text style={[styles.text, !line.isFinal && styles.textInterim]} numberOfLines={2}>
            {line.text}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 96,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(15,23,42,0.78)',
    gap: 4,
  },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  speaker: { color: '#A0AEC0', fontSize: 12, fontWeight: '600' },
  text: { color: '#FFFFFF', fontSize: 14, flexShrink: 1 },
  textInterim: { opacity: 0.65, fontStyle: 'italic' },
});
