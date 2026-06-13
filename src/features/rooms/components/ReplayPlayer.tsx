import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../../shared/constants/theme';
import { useVoicePlayback } from '../../../shared/services/audio/voicePlayback';

interface ReplayPlayerProps {
  url: string;
  durationMs: number | null;
}

const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Inline audio player for a room Replay. Streams the stored recording over its
 * public URL on the app-wide single player (de-Expo: react-native-audio-recorder-player
 * via the useVoicePlayback store — same engine the chat voice notes use), so a
 * Replay and a chat note never play over each other.
 */
const ReplayPlayer: React.FC<ReplayPlayerProps> = ({ url, durationMs }) => {
  const { t } = useTranslation();
  const playing = useVoicePlayback(s => s.activeUrl === url && s.playing);
  const positionMs = useVoicePlayback(s => (s.activeUrl === url ? s.positionMs : 0));
  const activeDurationMs = useVoicePlayback(s => (s.activeUrl === url ? s.durationMs : 0));
  const toggle = useVoicePlayback(s => s.toggle);

  const totalSec = durationMs != null ? durationMs / 1000 : activeDurationMs / 1000 || 0;
  const currentSec = positionMs / 1000;
  const progress = totalSec > 0 ? Math.min(1, currentSec / totalSec) : 0;
  const showElapsed = positionMs > 0;
  const clock = formatClock(showElapsed ? currentSec : totalSec);

  const onToggle = useCallback(() => {
    void toggle(url, durationMs);
  }, [toggle, url, durationMs]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? t('voice.pauseA11y') : t('replays.playA11y')}
        hitSlop={8}
        style={styles.playBtn}
      >
        <MaterialIcons name={playing ? 'pause' : 'play-arrow'} size={22} color={colors.onPrimary} />
      </Pressable>
      <View style={styles.body}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
      </View>
      <Text style={styles.time}>{clock}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, justifyContent: 'center' },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  time: {
    fontSize: 12,
    color: colors.textMuted,
    minWidth: 38,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});

export default ReplayPlayer;
