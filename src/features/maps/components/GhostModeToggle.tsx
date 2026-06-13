import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import Animated from 'react-native-reanimated';
import { useAnimatedPress } from '../../../shared/hooks/useAnimatedPress';
import { useGhostModeStore } from '../store/ghostModeStore';

const BUTTON_SIZE = 46;
const ICON_SIZE = 22;
const VISIBLE_COLOR = '#1E3A8A';
const HIDDEN_COLOR = '#9CA3AF';

/**
 * See / Unsee toggle — floating white chip stacked under the recenter button.
 * Persistence still flows through `useGhostModeStore`; the chip flips between
 * navy `visibility` (you are visible to followers) and grey `visibility-off`
 * (ghost mode on — you are hidden).
 */
export const GhostModeToggle: React.FC = () => {
  const isGhost = useGhostModeStore(s => s.isGhost);
  const toggle = useGhostModeStore(s => s.toggle);
  const press = useAnimatedPress({ scaleTo: 0.9 });

  const handlePress = useCallback(() => {
    void toggle();
  }, [toggle]);

  const isVisible = !isGhost;
  const icon: 'visibility' | 'visibility-off' = isVisible ? 'visibility' : 'visibility-off';
  const color = isVisible ? VISIBLE_COLOR : HIDDEN_COLOR;
  const label = isVisible ? 'SEE' : 'UNSEE';

  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={handlePress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="switch"
        accessibilityLabel={
          isVisible ? 'You are visible. Tap to hide.' : 'You are hidden. Tap to reveal.'
        }
        accessibilityState={{ checked: isGhost }}
        style={styles.button}
      >
        <MaterialIcons name={icon} size={ICON_SIZE} color={color} />
        <Text style={[styles.label, { color }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 2,
    letterSpacing: 0.5,
  },
});
