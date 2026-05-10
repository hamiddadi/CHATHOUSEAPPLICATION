import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { DEFAULTS } from '../../../shared/constants/images';
import type { FollowerOnMap } from '../../../shared/types/domain';

const CONTAINER_WIDTH = 70;
const CONTAINER_HEIGHT = 80;
const AVATAR_SIZE = 44;
const RING_SIZE = 54;
const PULSE_DURATION_MS = 800;
const PULSE_SCALE_PEAK = 1.4;
const PULSE_OPACITY_TROUGH = 0.2;
const PULSE_OPACITY_REST = 0.8;

const GREEN = '#22C55E';
const WHITE = '#FFFFFF';
const USERNAME_BG = 'rgba(0,0,0,0.55)';

interface FollowerPinProps {
  follower: FollowerOnMap;
}

/**
 * Avatar marker pinned on the map.
 * - In a live room → animated green pulse ring + green-bordered avatar + LIVE badge
 * - Otherwise      → white-bordered avatar only
 * Username badge sits under every marker for at-a-glance identification.
 */
export const FollowerPin: React.FC<FollowerPinProps> = memo(({ follower }) => {
  const isInRoom = follower.liveRoomId !== null;

  const scale = useSharedValue(1);
  const opacity = useSharedValue(PULSE_OPACITY_REST);

  useEffect(() => {
    if (!isInRoom) {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      scale.value = 1;
      opacity.value = PULSE_OPACITY_REST;
      return;
    }
    const easing = Easing.inOut(Easing.ease);
    scale.value = withRepeat(
      withTiming(PULSE_SCALE_PEAK, { duration: PULSE_DURATION_MS, easing }),
      -1,
      true,
    );
    opacity.value = withRepeat(
      withTiming(PULSE_OPACITY_TROUGH, { duration: PULSE_DURATION_MS, easing }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [isInRoom, opacity, scale]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.container}>
      {isInRoom && <Animated.View pointerEvents="none" style={[styles.pulseRing, ringStyle]} />}

      <View style={[styles.avatarWrapper, isInRoom && styles.avatarWrapperInRoom]}>
        <Image
          source={{ uri: follower.avatarUrl ?? DEFAULTS.avatar }}
          style={styles.avatar}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />
      </View>

      {isInRoom && (
        <View style={styles.liveBadge}>
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      )}

      <View style={styles.usernameBadge}>
        <Text style={styles.usernameText} numberOfLines={1}>
          {follower.username}
        </Text>
      </View>
    </View>
  );
});
FollowerPin.displayName = 'FollowerPin';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: CONTAINER_WIDTH,
    height: CONTAINER_HEIGHT,
  },
  pulseRing: {
    position: 'absolute',
    top: (CONTAINER_HEIGHT - RING_SIZE) / 2 - 8,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    backgroundColor: GREEN,
  },
  avatarWrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: WHITE,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  avatarWrapperInRoom: {
    borderWidth: 2.5,
    borderColor: GREEN,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  liveBadge: {
    position: 'absolute',
    top: 6,
    right: 4,
    backgroundColor: GREEN,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  liveText: {
    color: WHITE,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  usernameBadge: {
    marginTop: 4,
    backgroundColor: USERNAME_BG,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: CONTAINER_WIDTH,
  },
  usernameText: {
    color: WHITE,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
});
