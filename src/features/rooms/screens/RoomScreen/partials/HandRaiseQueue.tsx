import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '../../../../../shared/constants/theme';
import type { UserSummary } from '../../../../../shared/types/domain';
import SectionLabel from './SectionLabel';
import { HandRaisedCell } from './ListenerCell';

interface HandRaiseQueueProps {
  handRaises: UserSummary[];
  viewerCanModerate: boolean;
  onPromote: (user: UserSummary) => void;
}

const HandRaiseQueue: React.FC<HandRaiseQueueProps> = memo(
  ({ handRaises, viewerCanModerate, onPromote }) => {
    const { t } = useTranslation();
    if (handRaises.length === 0) return null;
    return (
      <View className="mb-huge">
        <SectionLabel label={`${t('room.handRaised')} · ${handRaises.length}`} />
        <View style={styles.handRaisedRow}>
          {handRaises.map(l => (
            <Pressable
              key={l.id}
              onPress={() => onPromote(l)}
              accessibilityRole={viewerCanModerate ? 'button' : undefined}
              accessibilityLabel={
                viewerCanModerate ? `Inviter ${l.displayName} à parler` : l.displayName
              }
            >
              <HandRaisedCell listener={l} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  },
);
HandRaiseQueue.displayName = 'HandRaiseQueue';

const styles = StyleSheet.create({
  handRaisedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
  },
});

export default HandRaiseQueue;
