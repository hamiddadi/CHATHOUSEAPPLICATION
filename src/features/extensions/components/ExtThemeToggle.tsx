import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useExtThemeMode, type ExtThemeMode } from '../providers/ExtThemeProvider';

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
    backgroundColor: '#F1F5F9',
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
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  emoji: { fontSize: 18 },
  label: { fontSize: 12, marginTop: 2, color: '#64748B' },
  labelActive: { color: '#0F172A', fontWeight: '600' },
});
