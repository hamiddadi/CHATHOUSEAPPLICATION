import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { getSocket } from '../../../../shared/services/realtime/socketClient';
import { useSendReaction } from '../../hooks/useRooms';

const EMOJIS = ['❤️', '🔥', '👏', '😂', '🌊', '🎉'] as const;
type Emoji = (typeof EMOJIS)[number];

const FLY_DURATION_MS = 1800;
const HORIZONTAL_JITTER = 30;

interface FloatingEmoji {
  id: string;
  emoji: string;
  startX: number;
}

interface ReactionsBarProps {
  roomId: string;
}

interface IncomingReaction {
  roomId: string;
  emoji: string;
  userId: string;
}

/**
 * Bottom-anchored float-up emoji bar — sends a reaction on tap, listens
 * to `room:reaction` socket events to animate everyone else's reactions
 * over the same area. The animation queue auto-clears so a viral room
 * doesn't blow up the React tree with 100s of orphan emojis.
 */
export const ReactionsBar: React.FC<ReactionsBarProps> = memo(({ roomId }) => {
  const sendReaction = useSendReaction();
  const [floats, setFloats] = useState<FloatingEmoji[]>([]);
  // Track in-flight cleanup timers so they can be purged on unmount —
  // otherwise a room that's left mid-animation leaves orphan timers that
  // fire setState on an unmounted component.
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const removeFloat = useCallback((id: string) => {
    setFloats(prev => prev.filter(f => f.id !== id));
  }, []);

  const spawnFloat = useCallback(
    (emoji: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const startX = (Math.random() - 0.5) * HORIZONTAL_JITTER;
      setFloats(prev => [...prev, { id, emoji, startX }]);
      // Cleanup matches the animation duration exactly so we never leave
      // a ghost mounted after the fade-out finishes.
      const t = setTimeout(() => {
        timers.current.delete(t);
        removeFloat(id);
      }, FLY_DURATION_MS + 100);
      timers.current.add(t);
    },
    [removeFloat],
  );

  // Purge any pending spawn timers when the bar unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const handleTap = useCallback(
    (emoji: Emoji) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      spawnFloat(emoji);
      sendReaction.mutate({ roomId, emoji });
    },
    [roomId, sendReaction, spawnFloat],
  );

  // Subscribe to peer reactions — every emoji others send animates here too.
  // Race-safety: roomId can change (or component unmount) while
  // getSocket() is still pending. Without `cancelled`, the next room's
  // socket would see the previous room's `spawnFloat` listener leak in.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;
      const handler = (payload: IncomingReaction): void => {
        if (payload.roomId !== roomId) return;
        spawnFloat(payload.emoji);
      };
      socket.on('room:reaction', handler);
      cleanup = () => socket.off('room:reaction', handler);
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [roomId, spawnFloat]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* Floating emojis: rendered above the bar, fly upward + fade out. */}
      <View style={styles.floatLayer} pointerEvents="none">
        {floats.map(f => (
          <FloatingEmojiView key={f.id} emoji={f.emoji} startX={f.startX} />
        ))}
      </View>
      <View style={styles.bar}>
        {EMOJIS.map(e => (
          <Pressable
            key={e}
            onPress={() => handleTap(e)}
            accessibilityRole="button"
            accessibilityLabel={`Send reaction ${e}`}
            style={styles.emojiBtn}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          >
            <Text style={styles.emojiText}>{e}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
});
ReactionsBar.displayName = 'ReactionsBar';

const FloatingEmojiView: React.FC<{ emoji: string; startX: number }> = memo(({ emoji, startX }) => {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.6);
  const settled = useRef(false);

  useEffect(() => {
    if (settled.current) return;
    settled.current = true;
    // Pop in, ride upward 180px, fade out at the end.
    opacity.value = withSequence(
      withTiming(1, { duration: 120 }),
      withTiming(1, { duration: FLY_DURATION_MS - 600 }),
      withTiming(0, { duration: 480 }),
    );
    scale.value = withTiming(1.1, { duration: 200, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(-180, {
      duration: FLY_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
  }, [opacity, scale, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: startX }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.floatingEmoji, animatedStyle]}>
      <Text style={styles.floatingEmojiText}>{emoji}</Text>
    </Animated.View>
  );
});
FloatingEmojiView.displayName = 'FloatingEmojiView';

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  floatLayer: {
    position: 'absolute',
    bottom: 56,
    width: '100%',
    height: 220,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  floatingEmoji: {
    position: 'absolute',
    bottom: 0,
  },
  floatingEmojiText: { fontSize: 26 },
  bar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(12,17,46,0.9)',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  emojiBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  emojiText: { fontSize: 22 },
});
