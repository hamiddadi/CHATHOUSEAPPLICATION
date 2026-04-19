import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const LOGO_ICON_SIZE = 24;

// Transparent Header - Maps — shadow kept on the foreground text so the
// map tiles remain readable without any background overlay.
const TEXT_SHADOW = {
  textShadowColor: 'rgba(0, 0, 0, 0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
} as const;

interface MapTopAppBarProps {
  onWave: () => void;
}

/**
 * Transparent Header - Maps — ZERO background. The map tiles show through
 * behind the row. Legibility is preserved by the text shadow on the
 * foreground text. Other screens are untouched (component is Maps-only).
 */
export const MapTopAppBar: React.FC<MapTopAppBarProps> = ({ onWave }) => {
  const handleWave = useCallback(() => onWave(), [onWave]);
  return (
    <View className="flex-row items-center justify-between px-xxl py-lg">
      <View className="flex-row items-center gap-sm">
        <MaterialIcons name="graphic-eq" size={LOGO_ICON_SIZE} color="#FFFFFF" />
        <Text
          className="text-xxl font-display tracking-tighter"
          style={[styles.titleText, TEXT_SHADOW]}
        >
          Chathouse
        </Text>
      </View>
      <Pressable
        onPress={handleWave}
        accessibilityRole="button"
        accessibilityLabel="Send a wave to your followers"
        className="rounded-pill px-lg py-xs active:opacity-70"
        style={styles.waveButton}
      >
        <Text className="text-sm font-headline" style={[styles.waveText, TEXT_SHADOW]}>
          Wave 👋
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  // Transparent Header - Maps — white title text
  titleText: {
    color: '#FFFFFF',
  },
  // Transparent Header - Maps — translucent white pill for the Wave button
  waveButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  waveText: {
    color: '#FFFFFF',
  },
});
