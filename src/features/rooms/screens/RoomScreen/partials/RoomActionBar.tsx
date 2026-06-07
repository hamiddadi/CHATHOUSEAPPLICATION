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
  /** Invite is available to every participant — opens the InviteToRoom screen. */
  onInvite: () => void;
  onLeave: () => void;
}

// Shared chrome for every action button so they're visually identical (same
// height, padding, radius, border, background). Only the icon tint carries
// meaning (danger for leave / live-mic). `w-full` makes the button fill its
// flex-1 slot so all buttons end up the same width on one row.
const BTN_CLASS =
  'w-full flex-row items-center justify-center gap-xs py-sm px-xs rounded-pill bg-overlay-white-10 border border-overlay-white-10';
const LABEL_CLASS = 'text-sm font-body-bold text-white';

const RoomActionBar: React.FC<RoomActionBarProps> = memo(
  ({ viewerCanSpeak, isMuted, isHandRaised, onToggleMute, onToggleHand, onInvite, onLeave }) => {
    const { t } = useTranslation();
    const muteBtn = useAnimatedPress({ scaleTo: 0.96 });
    const raiseBtn = useAnimatedPress({ scaleTo: 0.96 });
    const inviteBtn = useAnimatedPress({ scaleTo: 0.96 });
    const leaveBtn = useAnimatedPress({ scaleTo: 0.96 });

    return (
      <View style={styles.bar}>
        {viewerCanSpeak ? (
          <Animated.View style={[styles.slot, muteBtn.animatedStyle]}>
            <Pressable
              onPress={onToggleMute}
              onPressIn={muteBtn.onPressIn}
              onPressOut={muteBtn.onPressOut}
              accessibilityRole="button"
              accessibilityLabel={
                isMuted
                  ? t('room.unmuteA11y', 'Unmute microphone')
                  : t('room.muteA11y', 'Mute microphone')
              }
              accessibilityState={{ selected: isMuted }}
              className={BTN_CLASS}
            >
              <MaterialIcons
                name={isMuted ? 'mic-off' : 'mic'}
                size={ACTION_BAR_ICON_SIZE}
                color={isMuted ? colors.danger : colors.primary}
              />
              <Text className={LABEL_CLASS} numberOfLines={1}>
                {isMuted ? t('room.unmute') : t('room.mute')}
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}

        <Animated.View style={[styles.slot, raiseBtn.animatedStyle]}>
          <Pressable
            onPress={onToggleHand}
            onPressIn={raiseBtn.onPressIn}
            onPressOut={raiseBtn.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={
              isHandRaised ? t('room.lowerA11y', 'Lower hand') : t('room.raiseA11y', 'Raise hand')
            }
            accessibilityState={{ selected: isHandRaised }}
            className={BTN_CLASS}
          >
            <MaterialIcons name="pan-tool" size={ACTION_BAR_ICON_SIZE} color={colors.primary} />
            <Text className={LABEL_CLASS} numberOfLines={1}>
              {isHandRaised ? t('room.lower') : t('room.raise')}
            </Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={[styles.slot, inviteBtn.animatedStyle]}>
          <Pressable
            onPress={onInvite}
            onPressIn={inviteBtn.onPressIn}
            onPressOut={inviteBtn.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={t('room.invite')}
            className={BTN_CLASS}
          >
            <MaterialIcons name="person-add" size={ACTION_BAR_ICON_SIZE} color={colors.primary} />
            <Text className={LABEL_CLASS} numberOfLines={1}>
              {t('room.invite')}
            </Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={[styles.slot, leaveBtn.animatedStyle]}>
          <Pressable
            onPress={onLeave}
            onPressIn={leaveBtn.onPressIn}
            onPressOut={leaveBtn.onPressOut}
            accessibilityRole="button"
            // Full intent kept for screen readers; the visible label is shortened
            // so it fits the equal-width slot on one line.
            accessibilityLabel={t('room.leaveQuietly')}
            className={BTN_CLASS}
          >
            <MaterialIcons name="logout" size={ACTION_BAR_ICON_SIZE} color={colors.danger} />
            <Text className={LABEL_CLASS} numberOfLines={1}>
              {t('room.leave')}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  },
);
RoomActionBar.displayName = 'RoomActionBar';

const styles = StyleSheet.create({
  // Full-width backing pill: a single row that spans the available width (set
  // by the absolutely-positioned wrapper in RoomScreen) so the buttons never
  // overflow / get clipped off-screen.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    width: '100%',
    backgroundColor: 'rgba(12,17,46,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 9999,
    padding: spacing.xs,
  },
  // Each button takes an equal share of the row → identical widths, evenly
  // distributed, all on the same line.
  slot: {
    flex: 1,
  },
});

export default RoomActionBar;
