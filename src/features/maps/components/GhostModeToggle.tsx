import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { useAnimatedPress } from '../../../shared/hooks/useAnimatedPress';
import { colors } from '../../../shared/constants/theme';
import { useGhostModeStore } from '../store/ghostModeStore';

const TRACK_WIDTH = 40;
const THUMB_SIZE = 14;
const THUMB_OFFSET = 4;

/**
 * Floating pill at the bottom-left of the Map canvas.
 * Tap to toggle Ghost Mode; the visual switch flips to mirror the persisted state.
 */
export const GhostModeToggle: React.FC = () => {
  const isGhost = useGhostModeStore(s => s.isGhost);
  const toggle = useGhostModeStore(s => s.toggle);
  const press = useAnimatedPress({ scaleTo: 0.95 });

  const handlePress = useCallback(() => {
    void toggle();
  }, [toggle]);

  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={handlePress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="switch"
        accessibilityLabel="Ghost Mode"
        accessibilityHint={
          isGhost
            ? 'Turn off to share your location with followers'
            : 'Turn on to hide your location'
        }
        accessibilityState={{ checked: isGhost }}
        className="flex-row items-center gap-md bg-surface-highest/80 border border-overlay-white-10 rounded-pill px-xl py-md"
      >
        <MaterialIcons
          name={isGhost ? 'visibility-off' : 'visibility'}
          size={20}
          color={isGhost ? colors.primary : colors.textMuted}
        />
        <Text className="text-sm font-body-bold text-ink tracking-wide uppercase">
          Ghost Mode {isGhost ? 'ON' : 'OFF'}
        </Text>
        <View
          className={isGhost ? 'bg-primary rounded-pill' : 'bg-outline-variant rounded-pill'}
          style={styles.track}
        >
          <View
            className="bg-white rounded-pill"
            style={[
              styles.thumb,
              {
                transform: [
                  { translateX: isGhost ? TRACK_WIDTH - THUMB_SIZE - THUMB_OFFSET - 4 : 0 },
                ],
              },
            ]}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: THUMB_OFFSET,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
});
