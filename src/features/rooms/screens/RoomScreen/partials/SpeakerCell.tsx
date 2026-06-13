import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../../shared/components/Avatar';
import { useAnimatedPress } from '../../../../../shared/hooks/useAnimatedPress';
import { colors, spacing } from '../../../../../shared/constants/theme';
import type { RoomAudioState, RoomParticipant, RoomRole } from '../../../../../shared/types/domain';

const ROLE_ICON_SIZE = 10;
const SPEAKER_AVATAR = 56;

const GREEN = '#00e475';

const ROLE_COLORS = {
  shield: '#22C55E',
  mic: '#22C55E',
  micOff: '#EF4444',
} as const;

type RoleIconName = 'shield' | 'mic' | 'mic-off';

const getRoleIconProps = (
  role: RoomRole,
  audio: RoomAudioState,
): { icon: RoleIconName; color: string } => {
  if (audio === 'muted') return { icon: 'mic-off', color: ROLE_COLORS.micOff };
  if (role === 'host') return { icon: 'shield', color: ROLE_COLORS.shield };
  if (role === 'moderator') return { icon: 'shield', color: '#3B82F6' };
  return { icon: 'mic', color: ROLE_COLORS.mic };
};

const SpeakerCell: React.FC<{ speaker: RoomParticipant; isSpeakingLive?: boolean }> = memo(
  ({ speaker, isSpeakingLive = false }) => {
    // Live "is speaking" comes from mediasoup score broadcasts when audio is
    // active; `speaker.audio === 'speaking'` is a static fallback for the
    // unsupported case (no audio engine).
    const isSpeaking = isSpeakingLive || speaker.audio === 'speaking';
    const pulse = useAnimatedPress({ pulse: isSpeaking });
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
        <Animated.View style={[pulse.animatedStyle, styles.speakerRingWrapper]}>
          <Avatar
            uri={speaker.avatarUrl ?? undefined}
            name={speaker.displayName}
            sizeValue={SPEAKER_AVATAR}
            ring={isSpeaking}
            ringColor={GREEN}
            ringWidth={2}
          />
          {isSpeaking && (
            <View style={styles.speakerMicBadge}>
              <MaterialIcons name="graphic-eq" size={10} color="#00210b" />
            </View>
          )}
        </Animated.View>
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
