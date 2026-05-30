import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { NetQualityReport } from '../api/netqualityApi';

interface Props {
  report: NetQualityReport | null;
  size?: 'sm' | 'md';
}

/**
 * Three-bar network indicator (Clubhouse-style). Lights up bars by
 * `report.bars` (1-3). Greys out when no report is available.
 */
export const ExtNetworkQualityBars: React.FC<Props> = ({ report, size = 'md' }) => {
  const bars = report?.bars ?? 0;
  const tone = bars === 3 ? '#22C55E' : bars === 2 ? '#F59E0B' : bars === 1 ? '#EF4444' : '#94A3B8';
  const dims =
    size === 'sm'
      ? { width: 3, gap: 2, heights: [6, 9, 12] }
      : { width: 4, gap: 3, heights: [8, 12, 16] };

  return (
    <View
      // eslint-disable-next-line react-native/no-inline-styles
      style={[styles.row, { gap: dims.gap }]}
      accessibilityRole="image"
      accessibilityLabel={
        report
          ? `Network quality: ${bars} of 3 bars${report.warning ? ` (${report.warning})` : ''}`
          : 'Network quality unknown'
      }
    >
      {[0, 1, 2].map(i => {
        const height = dims.heights[i] ?? dims.heights[dims.heights.length - 1] ?? 0;
        const backgroundColor = i < bars ? tone : '#E2E8F0';
        return (
          <View
            key={i}
            // eslint-disable-next-line react-native/no-inline-styles
            style={[styles.bar, { width: dims.width, height, backgroundColor }]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  bar: { borderRadius: 1.5 },
});
