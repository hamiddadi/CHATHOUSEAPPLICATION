import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAnimatedPress } from '../../../../../shared/hooks/useAnimatedPress';
import { colors, spacing } from '../../../../../shared/constants/theme';

const ACTION_BAR_ICON_SIZE = 18;

interface RoomActionBarProps {
  /** Mic button only renders for users with publishing rights. */
  viewerCanSpeak: boolean;
  isMuted: boolean;
  isHandRaised: boolean;
  onToggleMute: () => void;
  onToggleHand: () => void;
  onLeave: () => void;
}

const RoomActionBar: React.FC<RoomActionBarProps> = memo(
  ({ viewerCanSpeak, isMuted, isHandRaised, onToggleMute, onToggleHand, onLeave }) => {
    const { t } = useTranslation();
    const muteBtn = useAnimatedPress({ scaleTo: 0.96 });
    const raiseBtn = useAnimatedPress({ scaleTo: 0.96 });
    const leaveBtn = useAnimatedPress({ scaleTo: 0.96 });

    return (
      <View style={styles.actionPill}>
        {viewerCanSpeak ? (
          <Animated.View style={muteBtn.animatedStyle}>
            <Pressable
              onPress={onToggleMute}
              onPressIn={muteBtn.onPressIn}
              onPressOut={muteBtn.onPressOut}
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              accessibilityState={{ selected: isMuted }}
              className="flex-row items-center gap-sm bg-danger rounded-pill py-sm px-xl"
            >
              <MaterialIcons
                name={isMuted ? 'mic-off' : 'mic'}
                size={ACTION_BAR_ICON_SIZE}
                color={colors.white}
              />
              <Text className="text-sm font-body-bold text-white">
                {isMuted ? t('room.unmute') : t('room.mute')}
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}

        <Animated.View style={raiseBtn.animatedStyle}>
          <Pressable
            onPress={onToggleHand}
            onPressIn={raiseBtn.onPressIn}
            onPressOut={raiseBtn.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={isHandRaised ? 'Lower hand' : 'Raise hand'}
            accessibilityState={{ selected: isHandRaised }}
            className="flex-row items-center gap-sm bg-primary/20 rounded-pill py-sm px-lg"
          >
            <MaterialIcons name="pan-tool" size={ACTION_BAR_ICON_SIZE} color={colors.primary} />
            <Text className="text-sm font-body-bold text-primary">
              {isHandRaised ? t('room.lower') : t('room.raise')}
            </Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={leaveBtn.animatedStyle}>
          <Pressable
            onPress={onLeave}
            onPressIn={leaveBtn.onPressIn}
            onPressOut={leaveBtn.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={t('room.leave')}
            className="flex-row items-center gap-sm border border-overlay-white-20 rounded-pill py-sm px-xl"
          >
            <MaterialIcons name="logout" size={ACTION_BAR_ICON_SIZE} color={colors.danger} />
            <Text className="text-sm font-body-bold text-white">{t('room.leave')}</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  },
);
RoomActionBar.displayName = 'RoomActionBar';

const styles = StyleSheet.create({
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(12,17,46,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 9999,
    padding: spacing.xs,
  },
});

export default RoomActionBar;
