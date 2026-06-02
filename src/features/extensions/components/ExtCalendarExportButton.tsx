import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text } from 'react-native';
import { calendarApi } from '../api/calendarApi';
import { colors } from '../../../shared/constants/theme';

interface Props {
  roomId: string;
  label?: string;
}

/**
 * "Add to Calendar" button — opens the .ics URL which iOS/Android route to
 * the native Calendar app on tap. Works for Apple Calendar, Google
 * Calendar (Android), and any installed handler.
 */
export const ExtCalendarExportButton: React.FC<Props> = ({ roomId, label = 'Add to Calendar' }) => {
  const [busy, setBusy] = useState(false);

  const handlePress = async (): Promise<void> => {
    setBusy(true);
    try {
      await Linking.openURL(calendarApi.icsUrl(roomId));
    } catch {
      /* swallow — best-effort */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={() => void handlePress()}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
    >
      {busy ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <>
          <Text style={styles.emoji}>📅</Text>
          <Text style={styles.text}>{label}</Text>
        </>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: colors.primary,
    gap: 8,
  },
  emoji: { fontSize: 16 },
  text: { color: colors.onPrimary, fontWeight: '600', fontSize: 13 },
});
