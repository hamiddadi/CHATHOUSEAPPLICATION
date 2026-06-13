import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GradientView } from '../../../../../shared/components/GradientView';

interface SectionLabelProps {
  label: string;
  emphasis?: boolean;
}

const SectionLabel: React.FC<SectionLabelProps> = memo(({ label, emphasis = false }) => (
  <View className="flex-row items-center gap-sm mb-lg px-xs">
    <Text
      className={
        emphasis
          ? 'text-[10px] font-body-bold text-accent tracking-widest uppercase'
          : 'text-[10px] font-body-bold text-ink-muted tracking-widest uppercase'
      }
    >
      {label}
    </Text>
    {emphasis && (
      <GradientView
        colors={['rgba(0,228,117,0.2)', 'rgba(0,228,117,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.sectionGradientLine}
      />
    )}
  </View>
));
SectionLabel.displayName = 'SectionLabel';

const styles = StyleSheet.create({
  sectionGradientLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
});

export default SectionLabel;
