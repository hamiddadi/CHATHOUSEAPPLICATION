import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../../../../shared/constants/theme';
import type { UserSummary } from '../../../../../shared/types/domain';
import SectionLabel from './SectionLabel';
import { OtherCell } from './ListenerCell';

const OTHER_AVATAR = 40;

interface OthersGridProps {
  /** Listeners NOT followed by the viewer (already filtered upstream). */
  participants: UserSummary[];
  /** Count of listeners beyond what the API returned (renders the +N chip). */
  overflow: number;
  onTap: (listener: UserSummary) => void;
}

const OthersGrid: React.FC<OthersGridProps> = memo(({ participants, overflow, onTap }) => {
  const { t } = useTranslation();
  const others = participants;
  if (others.length === 0 && overflow <= 0) return null;
  return (
    <View className="mb-huge">
      <SectionLabel label={t('room.others')} />
      <View style={styles.othersGrid}>
        {others.map(o => (
          <Pressable
            key={o.id}
            onPress={() => onTap(o)}
            accessibilityRole="button"
            accessibilityLabel={`Profil de ${o.displayName ?? o.username}`}
          >
            <OtherCell listener={o} />
          </Pressable>
        ))}
        {overflow > 0 && (
          <View style={styles.gridCell}>
            <View style={styles.overflowChip}>
              <Text className="text-[9px] font-body-bold text-primary">+{overflow}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
});
OthersGrid.displayName = 'OthersGrid';

const styles = StyleSheet.create({
  othersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  gridCell: {
    width: '20%',
    alignItems: 'center',
  },
  overflowChip: {
    width: OTHER_AVATAR,
    height: OTHER_AVATAR,
    borderRadius: OTHER_AVATAR / 2,
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default OthersGrid;
