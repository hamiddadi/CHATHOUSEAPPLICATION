import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAnimatedPress } from '../../../../../shared/hooks/useAnimatedPress';
import { colors, palette, spacing } from '../../../../../shared/constants/theme';

const ACTION_BAR_ICON_SIZE = 18;

// The pill buttons are ~34px tall (py-sm + 18px icon) — extend the touch area
// vertically to reach the 44px minimum. Horizontal slop is deliberately 0 so
// adjacent buttons (gap = spacing.sm) don't fight over the same touch.
const ACTION_HIT_SLOP = { top: 6, bottom: 6 } as const;

interface RoomActionBarProps {
  /** Mic button only renders for users with publishing rights. */
  viewerCanSpeak: boolean;
  isMuted: boolean;
  isMuteBusy: boolean;
  isHandRaised: boolean;
  onToggleMute: () => void;
  onToggleHand: () => void;
  /** Invite is available to every participant — opens the InviteToRoom screen. */
  onInvite: () => void;
  onLeave: () => void;
}

const RoomActionBar: React.FC<RoomActionBarProps> = memo(
  ({
    viewerCanSpeak,
    isMuted,
    isMuteBusy,
    isHandRaised,
    onToggleMute,
    onToggleHand,
    onInvite,
    onLeave,
  }) => {
    const { t } = useTranslation();
    const muteBtn = useAnimatedPress({ scaleTo: 0.96 });
    const raiseBtn = useAnimatedPress({ scaleTo: 0.96 });
    const inviteBtn = useAnimatedPress({ scaleTo: 0.96 });
    const leaveBtn = useAnimatedPress({ scaleTo: 0.96 });
    const { width, fontScale } = useWindowDimensions();
    const compact = width < 380 || fontScale > 1.3;

    return (
      <View style={styles.actionPill}>
        {viewerCanSpeak ? (
          <Animated.View style={muteBtn.animatedStyle}>
            <Pressable
              onPress={onToggleMute}
              disabled={isMuteBusy}
              onPressIn={muteBtn.onPressIn}
              onPressOut={muteBtn.onPressOut}
              accessibilityRole="button"
              accessibilityLabel={
                isMuted
                  ? t('room.unmuteA11y', 'Unmute microphone')
                  : t('room.muteA11y', 'Mute microphone')
              }
              accessibilityState={{ selected: isMuted, disabled: isMuteBusy, busy: isMuteBusy }}
              hitSlop={ACTION_HIT_SLOP}
              className="min-w-[44px] min-h-[44px] flex-row items-center justify-center gap-sm bg-danger rounded-pill py-sm px-sm"
            >
              <MaterialIcons
                name={isMuted ? 'mic-off' : 'mic'}
                size={ACTION_BAR_ICON_SIZE}
                color={palette.onError}
              />
              {!compact ? (
                <Text className="text-sm font-body-bold text-on-danger">
                  {isMuted ? t('room.unmute') : t('room.mute')}
                </Text>
              ) : null}
            </Pressable>
          </Animated.View>
        ) : null}

        <Animated.View style={raiseBtn.animatedStyle}>
          <Pressable
            onPress={onToggleHand}
            onPressIn={raiseBtn.onPressIn}
            onPressOut={raiseBtn.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={
              isHandRaised
                ? t('room.lowerHandA11y', 'Lower hand')
                : t('room.raiseHandA11y', 'Raise hand')
            }
            accessibilityState={{ selected: isHandRaised }}
            hitSlop={ACTION_HIT_SLOP}
            className="min-w-[44px] min-h-[44px] flex-row items-center justify-center gap-sm bg-primary/20 rounded-pill py-sm px-sm"
          >
            <MaterialIcons name="pan-tool" size={ACTION_BAR_ICON_SIZE} color={colors.primary} />
            {!compact ? (
              <Text className="text-sm font-body-bold text-primary">
                {isHandRaised ? t('room.lower') : t('room.raise')}
              </Text>
            ) : null}
          </Pressable>
        </Animated.View>

        <Animated.View style={inviteBtn.animatedStyle}>
          <Pressable
            onPress={onInvite}
            onPressIn={inviteBtn.onPressIn}
            onPressOut={inviteBtn.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={t('room.invite')}
            hitSlop={ACTION_HIT_SLOP}
            className="min-w-[44px] min-h-[44px] flex-row items-center justify-center gap-sm bg-overlay-white-5 rounded-pill py-sm px-sm"
          >
            <MaterialIcons name="person-add" size={ACTION_BAR_ICON_SIZE} color={colors.primary} />
            {!compact ? (
              <Text className="text-sm font-body-bold text-primary">{t('room.invite')}</Text>
            ) : null}
          </Pressable>
        </Animated.View>

        <Animated.View style={leaveBtn.animatedStyle}>
          <Pressable
            onPress={onLeave}
            onPressIn={leaveBtn.onPressIn}
            onPressOut={leaveBtn.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={t('room.leaveQuietly')}
            hitSlop={ACTION_HIT_SLOP}
            className="min-w-[44px] min-h-[44px] flex-row items-center justify-center gap-sm border border-overlay-white-20 rounded-pill py-sm px-sm"
          >
            <MaterialIcons name="logout" size={ACTION_BAR_ICON_SIZE} color={colors.danger} />
            {/* Visible label is the SHORT "Quitter"/"Leave" so the 3- and 4-button
                bar fits on one row without clipping the edge buttons; the full
                "Quitter discrètement" / "Leave quietly" stays as the a11y label
                above so intent is preserved for screen readers. */}
            {!compact ? (
              <Text className="text-sm font-body-bold text-white">{t('room.leave')}</Text>
            ) : null}
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
    gap: spacing.xs,
    backgroundColor: 'rgba(12,17,46,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 9999,
    padding: spacing.xs,
    maxWidth: '100%',
  },
});

export default RoomActionBar;
