import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '../../../../../shared/constants/theme';

const GLASS_BG = 'rgba(255,255,255,0.05)';

interface DateSeparatorProps {
  label: string;
}

const DateSeparator: React.FC<DateSeparatorProps> = memo(({ label }) => (
  <View style={styles.dateSeparator}>
    <Text className="text-[10px] font-body-bold text-ink-muted uppercase tracking-widest">
      {label}
    </Text>
  </View>
));
DateSeparator.displayName = 'DateSeparator';

const styles = StyleSheet.create({
  dateSeparator: {
    alignSelf: 'center',
    backgroundColor: GLASS_BG,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxs,
    borderRadius: 9999,
  },
});

export default DateSeparator;
