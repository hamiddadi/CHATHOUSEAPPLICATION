import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useNavigation } from '@react-navigation/native';
import { Avatar } from '../Avatar';
import { colors, layout, radii, shadows, spacing } from '../../constants/theme';
import { useCurrentRoom } from '../../../features/rooms/hooks/useRooms';
import type { RoomParticipant } from '../../types/domain';

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

  const handleTap = useCallback(() => {
    if (room) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- untyped composite navigator
      (navigation as { navigate: (screen: string, params: object) => void }).navigate('RoomsTab', {
        screen: 'Room',
        params: { roomId: room.id },
      });
    }
  }, [navigation, room]);

  const handleLeave = useCallback(() => {
    leave();
  }, [leave]);

  if (!room) return null;

  const bottomOffset = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.sm;

  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      exiting={FadeOutDown.duration(200)}
      style={[styles.wrapper, { bottom: bottomOffset }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={handleTap}
        accessibilityRole="button"
        accessibilityLabel={`Return to room: ${room.title}`}
        style={styles.bar}
      >
        <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.content}>
          {/* Speaker avatars */}
          <View style={styles.avatarStack}>
            {room.speakers.slice(0, 3).map((s: RoomParticipant, i: number) => (
              <View key={s.id} style={[styles.stackItem, i > 0 && styles.stackItemOverlap]}>
                <Avatar
                  uri={s.avatarUrl ?? undefined}
                  name={s.displayName}
                  sizeValue={28}
                  ring={s.audio === 'speaking'}
                  ringColor="#00e475"
                  ringWidth={1.5}
                />
              </View>
            ))}
          </View>

          {/* Room info */}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {room.title}
            </Text>
            <View style={styles.metaRow}>
              <MaterialIcons name="graphic-eq" size={10} color="#00e475" />
              <Text style={styles.meta}>
                {room.speakers.length} speaking · {room.listenersCount} listening
              </Text>
            </View>
          </View>

          {/* Mute toggle */}
          <Pressable
            onPress={toggleMute}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
            style={[styles.iconBtn, isMuted && styles.iconBtnMuted]}
            hitSlop={8}
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
            hitSlop={8}
          >
            <MaterialIcons name="call-end" size={16} color={colors.danger} />
          </Pressable>
        </View>
      </Pressable>
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
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackItem: {
    marginLeft: 0,
    borderWidth: 2,
    borderColor: colors.background,
    borderRadius: 16,
  },
  info: {
    flex: 1,
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
    gap: 4,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 10,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnMuted: {
    backgroundColor: 'rgba(255, 180, 171, 0.15)',
  },
  leaveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 180, 171, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackItemOverlap: {
    marginLeft: -8,
  },
});
