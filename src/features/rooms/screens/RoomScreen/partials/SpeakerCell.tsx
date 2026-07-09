import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../../shared/components/Avatar';
import { colors, spacing } from '../../../../../shared/constants/theme';
import type { RoomAudioState, RoomParticipant, RoomRole } from '../../../../../shared/types/domain';

const ROLE_ICON_SIZE = 10;
const SPEAKER_AVATAR = 56;
// Base ring sits just outside the avatar; it scales UP + fades OUT to radiate.
const RING_SIZE = SPEAKER_AVATAR + 6;
const RING_MAX_SCALE = 1.45;
const RING_CYCLE_MS = 1300;

// Speaking ring/badge — the theme's emerald "speaker/active" accent token
// (same value as the previous hardcoded #00e475).
const GREEN = colors.accent;

const ROLE_COLORS = {
  shield: colors.success,
  mic: colors.success,
  micOff: colors.danger,
} as const;

type RoleIconName = 'shield' | 'mic' | 'mic-off';

const getRoleIconProps = (
  role: RoomRole,
  audio: RoomAudioState,
): { icon: RoleIconName; color: string } => {
  if (audio === 'muted') return { icon: 'mic-off', color: ROLE_COLORS.micOff };
  if (role === 'host') return { icon: 'shield', color: ROLE_COLORS.shield };
  if (role === 'moderator') return { icon: 'shield', color: colors.primaryContainer };
  return { icon: 'mic', color: ROLE_COLORS.mic };
};

/**
 * One radiating green ring. Loops forever (scale up + fade out) so an active
 * speaker's avatar shows a live pulsing halo. Two of these are stacked with a
 * half-cycle delay to make the ripple continuous. Runs entirely on the UI
 * thread (Reanimated) and is only mounted while the speaker is talking.
 */
const PulseRing: React.FC<{ delay: number }> = memo(({ delay }) => {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: RING_CYCLE_MS, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(progress);
  }, [progress, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * (RING_MAX_SCALE - 1) }],
    opacity: (1 - progress.value) * 0.6,
  }));

  return (
    <View pointerEvents="none" style={styles.pulseLayer}>
      <Animated.View style={[styles.pulseRing, animatedStyle]} />
    </View>
  );
});
PulseRing.displayName = 'PulseRing';

const SpeakerCell: React.FC<{ speaker: RoomParticipant; isSpeakingLive?: boolean }> = memo(
  ({ speaker, isSpeakingLive = false }) => {
    // Live "is speaking" comes from LiveKit ActiveSpeakersChanged when audio is
    // active; `speaker.audio === 'speaking'` is a static fallback for the
    // unsupported case (no audio engine).
    const isSpeaking = isSpeakingLive || speaker.audio === 'speaking';
    const { icon: roleIcon, color: roleColor } = getRoleIconProps(speaker.role, speaker.audio);
    const { t } = useTranslation();
    const roleLabel =
      speaker.role === 'host'
        ? t('room.host')
        : speaker.role === 'moderator'
          ? t('room.moderator')
          : t('room.speaker');

    return (
      <View style={styles.speakerCell}>
        <View style={styles.speakerRingWrapper}>
          {/* Animated green halo — two staggered rings for a continuous ripple.
              Rendered behind the avatar so they radiate around it. */}
          {isSpeaking && (
            <>
              <PulseRing delay={0} />
              <PulseRing delay={RING_CYCLE_MS / 2} />
            </>
          )}
          <Avatar
            uri={speaker.avatarUrl ?? undefined}
            name={speaker.displayName}
            sizeValue={SPEAKER_AVATAR}
            ring={isSpeaking}
            ringColor={GREEN}
            ringWidth={2.5}
          />
          {isSpeaking && (
            <View style={styles.speakerMicBadge}>
              {/* Dark-on-emerald foreground — onAccent is the closest theme
                  token to the previous hardcoded #00210b. */}
              <MaterialIcons name="graphic-eq" size={10} color={colors.onAccent} />
            </View>
          )}
        </View>
        <Text
          className="text-[10px] font-body-bold text-white text-center"
          numberOfLines={1}
          style={styles.speakerName}
        >
          {speaker.displayName}
        </Text>
        <View className="flex-row items-center gap-xxs">
          <MaterialIcons name={roleIcon} size={ROLE_ICON_SIZE} color={roleColor} />
          <Text
            style={{ fontSize: ROLE_ICON_SIZE, lineHeight: ROLE_ICON_SIZE + 2, color: roleColor }}
            className="font-body-bold uppercase tracking-tighter"
          >
            {roleLabel}
          </Text>
        </View>
      </View>
    );
  },
);
SpeakerCell.displayName = 'SpeakerCell';

const styles = StyleSheet.create({
  speakerCell: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.xs,
  },
  speakerRingWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Fills the avatar box and centers the ring, so scaling keeps it concentric.
  // overflow stays visible so the ring can radiate beyond the avatar.
  pulseLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2.5,
    borderColor: GREEN,
  },
  speakerMicBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: GREEN,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerName: {
    maxWidth: SPEAKER_AVATAR,
  },
});

export default SpeakerCell;
