import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../shared/constants/theme';

/**
 * Appearance indicator for the Settings screen.
 *
 * The app ships a single, mono-dark theme. The former three-segment
 * auto/light/dark switch was decorative — only the StatusBar reacted while the
 * rest of the UI (static color tokens) stayed dark, so it lied to the user.
 * It's been replaced by a static, non-interactive "Dark" indicator that states
 * the actual appearance without offering unreachable light/auto modes.
 */
export const ExtThemeToggle: React.FC = () => {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Text style={styles.emoji}>🌙</Text>
      <Text style={styles.label}>{t('extensions.theme.dark', 'Dark')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  emoji: { fontSize: 16, color: colors.text },
  label: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
});
