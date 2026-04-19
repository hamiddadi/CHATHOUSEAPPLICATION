import React, { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { useAnimatedPress } from '../../../shared/hooks/useAnimatedPress';
import { GOOGLE_MAPS_COLORS } from '../constants/mapColors';

const BUTTON_SIZE = 44;
const ICON_SIZE = 22;

interface MyLocationButtonProps {
  onPress: () => void;
  /** Greys out the icon when no coords are available yet. */
  disabled?: boolean;
}

/**
 * Recenter-on-user button — Google Maps target/crosshair style.
 * Callers are responsible for animating the map to the user's location;
 * this component only handles the tap feedback and visuals.
 */
export const MyLocationButton: React.FC<MyLocationButtonProps> = memo(
  ({ onPress, disabled = false }) => {
    const press = useAnimatedPress({ scaleTo: 0.9 });

    return (
      <Animated.View style={press.animatedStyle}>
        <Pressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Recenter map on my location"
          accessibilityHint="Re-centers the map on your current GPS position"
          accessibilityState={{ disabled }}
          style={[styles.button, disabled && styles.buttonDisabled]}
        >
          <MaterialIcons
            name="my-location"
            size={ICON_SIZE}
            color={disabled ? GOOGLE_MAPS_COLORS.poiSecondary : GOOGLE_MAPS_COLORS.poi}
          />
        </Pressable>
      </Animated.View>
    );
  },
);
MyLocationButton.displayName = 'MyLocationButton';

const styles = StyleSheet.create({
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
