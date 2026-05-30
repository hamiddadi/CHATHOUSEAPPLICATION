import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  roomTitle: string | null;
  hostName?: string | null;
  isMuted?: boolean;
  onTapBack: () => void;
  onToggleMute?: () => void;
  onLeave?: () => void;
}

/**
 * Persistent mini-bar that overlays the bottom of the app whenever the
 * user is in an audio room but viewing a different screen — Clubhouse's
 * "Back to room" pill (Module 6.7 / AUDIO-018).
 *
 * The legacy navigator owns when to mount this banner (typically: read
 * `useAuthStore` for the current room id). Pure presentational here.
 */
export const ExtBackToRoomBanner: React.FC<Props> = ({
  visible,
  roomTitle,
  hostName,
  isMuted = false,
  onTapBack,
  onToggleMute,
  onLeave,
}) => {
  if (!visible) return null;

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe} pointerEvents="box-none">
      <View style={styles.bar}>
        <Pressable
          style={styles.tapArea}
          onPress={onTapBack}
          accessibilityRole="button"
          accessibilityLabel="Back to the active room"
        >
          <View style={styles.indicator} />
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={1}>
              {roomTitle ?? 'In a room'}
            </Text>
            {hostName ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                with {hostName}
              </Text>
            ) : null}
          </View>
        </Pressable>

        {onToggleMute ? (
          <Pressable
            style={[styles.action, isMuted && styles.actionMuted]}
            onPress={onToggleMute}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <Text style={styles.actionText}>{isMuted ? '🚫' : '🎙️'}</Text>
          </Pressable>
        ) : null}

        {onLeave ? (
          <Pressable
            style={[styles.action, styles.actionLeave]}
            onPress={onLeave}
            accessibilityRole="button"
            accessibilityLabel="Leave room"
          >
            <Text style={styles.actionText}>✕</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    gap: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  tapArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  subtitle: { color: '#94A3B8', fontSize: 12, marginTop: 1 },
  action: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionMuted: { backgroundColor: 'rgba(239,68,68,0.15)' },
  actionLeave: { backgroundColor: 'rgba(239,68,68,0.18)' },
  actionText: { color: '#FFFFFF', fontSize: 16 },
});
