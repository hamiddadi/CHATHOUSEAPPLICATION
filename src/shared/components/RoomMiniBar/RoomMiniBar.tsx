import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import type { NavigationState, PartialState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../Avatar';
import { colors, layout, radii, shadows, spacing } from '../../constants/theme';
import { useCurrentRoom } from '../../../features/rooms/hooks/useRooms';
import type { RoomParticipant } from '../../types/domain';

const NARROW_LAYOUT_WIDTH = 360;

// Walk the nested navigator state down to the focused leaf route name, so the
// mini-bar can hide itself while the Room screen is actually open (it's mounted
// above the tab navigator and Room lives inside RoomsTab, so without this it
// would stack on top of the live room).
const activeLeafName = (
  state: NavigationState | PartialState<NavigationState> | undefined,
): string | undefined => {
  if (!state || state.routes.length === 0) return undefined;
  const idx = state.index ?? state.routes.length - 1;
  const route = state.routes[idx];
  if (!route) return undefined;
  return route.state ? activeLeafName(route.state) : route.name;
};

/**
 * Persistent mini-bar that floats above the bottom tab bar whenever the
 * user is "in a room" but navigating away from the Room screen. Tap
 * returns to the live room. Shows the room title, speaker count, and a
 * mute toggle. Hidden on the Room screen itself (avoids stacking).
 *
 * Fixes audit items 3.20, 5.51–5.56.
 */
export const RoomMiniBar: React.FC = memo(() => {
  const navigation = useNavigation();
  const { room, isMuted, toggleMute, leave } = useCurrentRoom();
  const activeRoute = useNavigationState(activeLeafName);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const handleTap = useCallback(() => {
    if (room) {
      // The mini-bar renders in MainNavigator as a SIBLING of the tab navigator,
      // so its navigation context is the ROOT stack (which owns 'Main'), NOT the
      // tab navigator. Navigating straight to 'RoomsTab' therefore threw
      // "The action 'NAVIGATE' … was not handled by any navigator" and the room
      // never re-opened. Route through 'Main' first — the same nested shape
      // RoomScreen uses for its cross-tab jumps (see handleMessageUser).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- untyped composite navigator
      (navigation as { navigate: (screen: string, params: object) => void }).navigate('Main', {
        screen: 'RoomsTab',
        params: { screen: 'Room', params: { roomId: room.id } },
      });
    }
  }, [navigation, room]);

  const handleLeave = useCallback(() => {
    leave();
  }, [leave]);

  // Hidden when not in a room, and while the Room screen itself is focused
  // (the live room already shows full controls — the mini-bar is the
  // navigated-away "resume" affordance).
  if (!room || activeRoute === 'Room') return null;

  const bottomOffset = insets.bottom + layout.tabBarHeight + layout.tabBarBottomOffset + spacing.sm;
  const isNarrow = windowWidth < NARROW_LAYOUT_WIDTH;
  const visibleSpeakers = room.speakers.slice(0, isNarrow ? 1 : 3);

  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      exiting={FadeOutDown.duration(200)}
      style={[styles.wrapper, { bottom: bottomOffset }]}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>
        <View style={[StyleSheet.absoluteFill, styles.glassBg]} />
        <View style={[styles.content, isNarrow && styles.contentNarrow]}>
          {/* The three sibling actions keep gestures and accessibility focus independent. */}
          <Pressable
            onPress={handleTap}
            accessibilityRole="button"
            accessibilityLabel={`Return to room: ${room.title}`}
            style={[styles.roomAction, isNarrow && styles.roomActionNarrow]}
          >
            {visibleSpeakers.length > 0 ? (
              <View style={styles.avatarStack}>
                {visibleSpeakers.map((s: RoomParticipant, i: number) => (
                  <View key={s.id} style={[styles.stackItem, i > 0 && styles.stackItemOverlap]}>
                    <Avatar
                      uri={s.avatarUrl ?? undefined}
                      name={s.displayName}
                      sizeValue={28}
                      ring={s.audio === 'speaking'}
                      ringColor={colors.accent}
                      ringWidth={1.5}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
                {room.title}
              </Text>
              <View style={styles.metaRow}>
                <MaterialIcons name="graphic-eq" size={10} color={colors.accent} />
                <Text style={styles.meta} numberOfLines={1} ellipsizeMode="tail">
                  {room.speakers.length} speaking · {room.listenersCount} listening
                </Text>
              </View>
            </View>
          </Pressable>

          {/* Mute toggle */}
          <Pressable
            onPress={toggleMute}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
            style={[styles.iconBtn, isMuted && styles.iconBtnMuted]}
          >
            <MaterialIcons
              name={isMuted ? 'mic-off' : 'mic'}
              size={16}
              color={isMuted ? colors.danger : colors.text}
            />
          </Pressable>

          {/* Leave button */}
          <Pressable
            onPress={handleLeave}
            accessibilityRole="button"
            accessibilityLabel="Leave room"
            style={styles.leaveBtn}
          >
            <MaterialIcons name="call-end" size={16} color={colors.danger} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
});
RoomMiniBar.displayName = 'RoomMiniBar';

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.xxl,
    right: spacing.xxl,
    zIndex: 199,
  },
  bar: {
    borderRadius: radii.xxl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    ...shadows.md,
  },
  // Opaque navy glass background — replaces the former expo-blur BlurView
  // (de-Expo migration). Matches the bottom tab bar's Android treatment for a
  // cohesive, readable floating surface (no real blur without the native module).
  glassBg: {
    backgroundColor: 'rgba(7,11,40,0.92)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  contentNarrow: {
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  roomAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  roomActionNarrow: {
    gap: spacing.xs,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  stackItem: {
    marginLeft: 0,
    borderWidth: 2,
    borderColor: colors.background,
    borderRadius: 16,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 4,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 10,
    flexShrink: 1,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    flexShrink: 0,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnMuted: {
    backgroundColor: 'rgba(255, 180, 171, 0.15)',
  },
  leaveBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    flexShrink: 0,
    backgroundColor: 'rgba(255, 180, 171, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackItemOverlap: {
    marginLeft: -8,
  },
});
