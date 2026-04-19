import { useCallback, useEffect } from 'react';
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

const DEFAULT_SCALE_TO = 0.96;
const DEFAULT_PRESS_DURATION_MS = 120;
const DEFAULT_PULSE_DURATION_MS = 1400;
const PULSE_PEAK_SCALE = 1.05;
const PULSE_TROUGH_OPACITY = 0.6;
const RESTORE_SPRING = { damping: 12, stiffness: 180 } as const;

interface UseAnimatedPressOptions {
  /** Target scale on press-in. Defaults to 0.96 (equivalent to Tailwind's `active:scale-96`). */
  scaleTo?: number;
  /** Press-in timing, in milliseconds. Defaults to 120. */
  pressDuration?: number;
  /** When true, an infinite pulse loop (scale + opacity) plays regardless of press state. */
  pulse?: boolean;
  /** Full pulse cycle duration, in milliseconds. Defaults to 1400. */
  pulseDuration?: number;
}

interface UseAnimatedPressReturn {
  animatedStyle: AnimatedStyle;
  onPressIn: () => void;
  onPressOut: () => void;
}

/**
 * Composable press + pulse animation hook (Reanimated v3).
 *
 * - `onPressIn` / `onPressOut` drive a snappy scale animation — wire to any `Pressable`.
 * - `pulse` starts an infinite breathing loop (scale + opacity) for live indicators.
 *
 * @example Press feedback
 * const { animatedStyle, onPressIn, onPressOut } = useAnimatedPress({ scaleTo: 0.96 });
 * return (
 *   <Animated.View style={animatedStyle}>
 *     <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
 *       ...
 *     </Pressable>
 *   </Animated.View>
 * );
 *
 * @example Pulse (live speaker ring)
 * const { animatedStyle } = useAnimatedPress({ pulse: true });
 */
export const useAnimatedPress = ({
  scaleTo = DEFAULT_SCALE_TO,
  pressDuration = DEFAULT_PRESS_DURATION_MS,
  pulse = false,
  pulseDuration = DEFAULT_PULSE_DURATION_MS,
}: UseAnimatedPressOptions = {}): UseAnimatedPressReturn => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!pulse) return;

    const half = pulseDuration / 2;
    scale.value = withRepeat(
      withSequence(
        withTiming(PULSE_PEAK_SCALE, { duration: half }),
        withTiming(1, { duration: half }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(PULSE_TROUGH_OPACITY, { duration: half }),
        withTiming(1, { duration: half }),
      ),
      -1,
      false,
    );

    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      scale.value = 1;
      opacity.value = 1;
    };
  }, [pulse, pulseDuration, scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const onPressIn = useCallback(() => {
    if (pulse) return;
    scale.value = withTiming(scaleTo, { duration: pressDuration });
  }, [scale, scaleTo, pressDuration, pulse]);

  const onPressOut = useCallback(() => {
    if (pulse) return;
    scale.value = withSpring(1, RESTORE_SPRING);
  }, [scale, pulse]);

  return { animatedStyle, onPressIn, onPressOut };
};
