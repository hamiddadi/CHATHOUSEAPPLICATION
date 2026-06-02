import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useExtThemeMode, type ExtThemeMode } from '../providers/ExtThemeProvider';
import { colors } from '../../../shared/constants/theme';

const OPTIONS: { value: ExtThemeMode; label: string; emoji: string }[] = [
  { value: 'auto', label: 'Auto', emoji: '🌓' },
  { value: 'light', label: 'Light', emoji: '☀️' },
  { value: 'dark', label: 'Dark', emoji: '🌙' },
];

/**
 * Three-segment toggle (auto / light / dark) for the Settings screen.
 * Pure addition — the host screen opts in by rendering this component.
 */
export const ExtThemeToggle: React.FC = () => {
  const { mode, setMode } = useExtThemeMode();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {OPTIONS.map(opt => {
        const active = mode === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => setMode(opt.value)}
            style={[styles.segment, active && styles.segmentActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Theme mode ${opt.label}`}
          >
            <Text style={styles.emoji}>{opt.emoji}</Text>
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.overlayWhite5,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: colors.overlayWhite10,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  emoji: { fontSize: 18, color: colors.text },
  label: { fontSize: 12, marginTop: 2, color: colors.textMuted },
  labelActive: { color: colors.text, fontWeight: '600' },
});
