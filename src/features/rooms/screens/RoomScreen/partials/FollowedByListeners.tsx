import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '../../../../../shared/constants/theme';
import type { UserSummary } from '../../../../../shared/types/domain';
import SectionLabel from './SectionLabel';
import { FollowedCell } from './ListenerCell';

interface FollowedByListenersProps {
  /** Listeners already filtered to those followed by the viewer. */
  participants: UserSummary[];
  /** Cap on rendered avatars; the rest overflow into the "+N" pattern upstream. */
  maxVisible: number;
  onTap: (listener: UserSummary) => void;
}

const FollowedByListeners: React.FC<FollowedByListenersProps> = memo(
  ({ participants, maxVisible, onTap }) => {
    const { t } = useTranslation();
    const visible = useMemo(() => participants.slice(0, maxVisible), [participants, maxVisible]);
    if (visible.length === 0) return null;
    return (
      <View className="mb-huge">
        <SectionLabel label={t('room.followedBy')} />
        <View style={styles.followedRow}>
          {visible.map(l => (
            <Pressable
              key={l.id}
              onPress={() => onTap(l)}
              accessibilityRole="button"
              accessibilityLabel={`Profil de ${l.displayName ?? l.username}`}
            >
              <FollowedCell listener={l} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  },
);
FollowedByListeners.displayName = 'FollowedByListeners';

const styles = StyleSheet.create({
  followedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
});

export default FollowedByListeners;
