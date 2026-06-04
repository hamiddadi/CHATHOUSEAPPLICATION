import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../../shared/constants/theme';

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
 * public URL via expo-audio (same engine as the chat voice notes). One player
 * per mounted row; the Replays list virtualizes so only visible rows hold one.
 */
const ReplayPlayer: React.FC<ReplayPlayerProps> = ({ url, durationMs }) => {
  const { t } = useTranslation();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const totalSec = durationMs != null ? durationMs / 1000 : status.duration || 0;
  const progress = totalSec > 0 ? Math.min(1, status.currentTime / totalSec) : 0;
  const showElapsed = status.playing || status.currentTime > 0;
  const clock = formatClock(showElapsed ? status.currentTime : totalSec);

  const onToggle = useCallback(() => {
    if (status.playing) {
      player.pause();
      return;
    }
    void setAudioModeAsync({ playsInSilentMode: true });
    if (status.didJustFinish || (totalSec > 0 && status.currentTime >= totalSec)) {
      player.seekTo(0);
    }
    player.play();
  }, [player, status.playing, status.didJustFinish, status.currentTime, totalSec]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? t('voice.pauseA11y') : t('replays.playA11y')}
        hitSlop={8}
        style={styles.playBtn}
      >
        <MaterialIcons
          name={status.playing ? 'pause' : 'play-arrow'}
          size={22}
          color={colors.onPrimary}
        />
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
