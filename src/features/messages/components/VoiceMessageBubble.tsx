import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../../shared/constants/theme';
import { useVoicePlayback } from '../../../shared/services/audio/voicePlayback';

interface VoiceMessageBubbleProps {
  audioUrl: string;
  /** Clip length captured at record time; falls back to the player's report. */
  durationMs: number | null;
  /** Tints the controls to read on a sent (primary) vs received (glass) bubble. */
  isMine: boolean;
}

const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Inline player for an async voice note. Rendered inside the caller's message
 * bubble (which supplies the background), so it only paints the play control,
 * a progress track, and the time. Playback runs on the app-wide single player
 * (de-Expo: react-native-audio-recorder-player via the useVoicePlayback store),
 * so only one note plays at a time. Selective store subscriptions keep inactive
 * rows from re-rendering on the active clip's per-tick position updates.
 */
const VoiceMessageBubble: React.FC<VoiceMessageBubbleProps> = ({
  audioUrl,
  durationMs,
  isMine,
}) => {
  const { t } = useTranslation();
  const playing = useVoicePlayback(s => s.activeUrl === audioUrl && s.playing);
  const positionMs = useVoicePlayback(s => (s.activeUrl === audioUrl ? s.positionMs : 0));
  const activeDurationMs = useVoicePlayback(s => (s.activeUrl === audioUrl ? s.durationMs : 0));
  const toggle = useVoicePlayback(s => s.toggle);

  const totalSec = durationMs != null ? durationMs / 1000 : activeDurationMs / 1000 || 0;
  const currentSec = positionMs / 1000;
  const progress = totalSec > 0 ? Math.min(1, currentSec / totalSec) : 0;
  const showElapsed = positionMs > 0;
  const clock = formatClock(showElapsed ? currentSec : totalSec);

  const onToggle = useCallback(() => {
    void toggle(audioUrl, durationMs);
  }, [toggle, audioUrl, durationMs]);

  const fg = isMine ? '#FFFFFF' : colors.text;
  const trackBg = isMine ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)';

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? t('voice.pauseA11y') : t('voice.playA11y')}
        hitSlop={8}
        style={[styles.playBtn, { borderColor: fg }]}
      >
        <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={20} color={fg} />
      </Pressable>
      <View style={styles.body}>
        <View style={[styles.track, { backgroundColor: trackBg }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: fg }]} />
        </View>
      </View>
      <Text style={[styles.time, { color: fg }]}>{clock}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 180 },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2 },
  time: { fontSize: 11, minWidth: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
});

export default VoiceMessageBubble;
