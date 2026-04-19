import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useAnimatedPress } from '../../../shared/hooks/useAnimatedPress';
import { GOOGLE_MAPS_COLORS } from '../constants/mapColors'; // Google Maps color style

const OUTER_SIZE = 32;
const INNER_SIZE = 16;
const OUTER_OPACITY = 0.4;

/**
 * Custom pulsing blue dot for the user's current location.
 * Uses the Google Maps POI blue (#4A80F5) to match the Voyager tiles palette.
 */
export const UserLocationPulse: React.FC = () => {
  const pulse = useAnimatedPress({ pulse: true, pulseDuration: 2000 });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.outer, pulse.animatedStyle]} />
      <View style={styles.inner} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: OUTER_SIZE,
    height: OUTER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Google Maps color style — outer pulsating halo, vivid Google blue at 40% opacity
  outer: {
    position: 'absolute',
    width: OUTER_SIZE,
    height: OUTER_SIZE,
    borderRadius: OUTER_SIZE / 2,
    backgroundColor: GOOGLE_MAPS_COLORS.poi,
    opacity: OUTER_OPACITY,
  },
  // Google Maps color style — solid core dot, vivid Google blue with white ring
  inner: {
    width: INNER_SIZE,
    height: INNER_SIZE,
    borderRadius: INNER_SIZE / 2,
    backgroundColor: GOOGLE_MAPS_COLORS.poi,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
