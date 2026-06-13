import React, { memo, useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { DEFAULTS } from '../../../shared/constants/images';

const GREEN = '#22C55E';
const WHITE = '#FFFFFF';

const DEFAULT_SIZE = 60;
const RING_THICKNESS = 3;
const STATUS_DOT_SIZE = 10;
const STATUS_DOT_BORDER = 2;

// Pulse cycle: scale 1 → 1.15 → 1 · opacity 1 → 0.3 → 1 · total 1200ms.
const PULSE_DURATION_MS = 1200;
const PULSE_SCALE_PEAK = 1.15;
const PULSE_OPACITY_TROUGH = 0.3;

export interface PulsingAvatarProps {
  avatar: string;
  /** Diameter of the avatar in pixels. Defaults to 60. */
  size?: number;
  /** Set to false to freeze the pulse (e.g. for screenshots). */
  pulsing?: boolean;
  /** Color of the small status dot border. Defaults to white; pass a dark color to match a dark-themed parent. */
  dotBorderColor?: string;
}

/**
 * Circular avatar with an animated green halo signaling online presence.
 * A fixed green status dot sits at the bottom-right of the image.
 *
 * Uses Reanimated (project convention) — swap the two `withRepeat` calls
 * for `Animated.loop(Animated.timing(...))` if you need core RN Animated.
 */
export const PulsingAvatar: React.FC<PulsingAvatarProps> = memo(
  ({ avatar, size = DEFAULT_SIZE, pulsing = true, dotBorderColor = WHITE }) => {
    const scale = useSharedValue(1);
    const opacity = useSharedValue(1);
    const [failed, setFailed] = useState(false);
    const handleError = useCallback(() => setFailed(true), []);

    useEffect(() => {
      if (!pulsing) {
        scale.value = 1;
        opacity.value = 1;
        return;
      }
      const half = PULSE_DURATION_MS / 2;
      const easing = Easing.inOut(Easing.ease);
      scale.value = withRepeat(withTiming(PULSE_SCALE_PEAK, { duration: half, easing }), -1, true);
      opacity.value = withRepeat(
        withTiming(PULSE_OPACITY_TROUGH, { duration: half, easing }),
        -1,
        true,
      );
      return () => {
        cancelAnimation(scale);
        cancelAnimation(opacity);
      };
    }, [pulsing, scale, opacity]);

    const ringStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    }));

    const ringSize = size + RING_THICKNESS * 2;

    return (
      <View style={[styles.container, { width: ringSize, height: ringSize }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              borderWidth: RING_THICKNESS,
            },
            ringStyle,
          ]}
        />
        <Image
          source={{ uri: failed ? DEFAULTS.avatar : avatar }}
          onError={handleError}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
        />
        <View
          style={[
            styles.statusDot,
            {
              width: STATUS_DOT_SIZE + STATUS_DOT_BORDER * 2,
              height: STATUS_DOT_SIZE + STATUS_DOT_BORDER * 2,
              borderRadius: (STATUS_DOT_SIZE + STATUS_DOT_BORDER * 2) / 2,
              borderWidth: STATUS_DOT_BORDER,
              borderColor: dotBorderColor,
            },
          ]}
        />
      </View>
    );
  },
);
PulsingAvatar.displayName = 'PulsingAvatar';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderColor: GREEN,
  },
  statusDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: GREEN,
  },
});
