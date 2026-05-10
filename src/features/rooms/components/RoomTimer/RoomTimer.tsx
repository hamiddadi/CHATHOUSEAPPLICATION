import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../../../../shared/constants/theme';

interface RoomTimerProps {
  /** ISO timestamp the room started. */
  startedAt: string;
}

const format = (totalSec: number): string => {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * Lightweight live counter — ticks once per second from the room's
 * `startedAt`. Doesn't pull from the server; the discrepancy across
 * clocks is bounded by the JWT iat the user trusts anyway.
 */
export const RoomTimer: React.FC<RoomTimerProps> = ({ startedAt }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startMs = new Date(startedAt).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));

  return (
    <View style={styles.wrap} accessibilityLabel={`Room ouverte depuis ${format(elapsedSec)}`}>
      <MaterialIcons name="schedule" size={11} color={colors.textMuted} />
      <Text style={styles.text}>{format(elapsedSec)}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  text: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
});
