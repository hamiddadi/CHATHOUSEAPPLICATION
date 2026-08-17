import React, { memo } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '../../../../../shared/constants/theme';
import type { RoomParticipant } from '../../../../../shared/types/domain';
import SectionLabel from './SectionLabel';
import SpeakerCell from './SpeakerCell';

interface StageGridProps {
  speakers: RoomParticipant[];
  /** speaker.id → live "is speaking" flag (derived from audio scores upstream). */
  speakingLiveByUser: Map<string, boolean>;
  viewerCanModerate: boolean;
  onParticipantPress: (participant: RoomParticipant) => void;
}

const MAX_COLUMNS = 5;
const MIN_COLUMN_WIDTH = 80;

export const getStageColumnCount = (viewportWidth: number): number => {
  const availableWidth = Math.max(0, viewportWidth - spacing.xxl * 2);
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor(availableWidth / MIN_COLUMN_WIDTH)));
};

const StageGrid: React.FC<StageGridProps> = memo(
  ({ speakers, speakingLiveByUser, viewerCanModerate, onParticipantPress }) => {
    const { t } = useTranslation();
    const { width } = useWindowDimensions();
    const columns = getStageColumnCount(width);
    const speakerWidth = `${100 / columns}%` as `${number}%`;
    return (
      <View className="mb-huge">
        <SectionLabel label={`⭐ ${t('room.stage')}`} emphasis />
        <View style={styles.stageGrid}>
          {speakers.map(s => {
            const isSpeakingLive = speakingLiveByUser.get(s.id) ?? false;
            return (
              <Pressable
                key={s.id}
                onPress={() => onParticipantPress(s)}
                accessibilityRole="button"
                accessibilityLabel={
                  viewerCanModerate
                    ? t('room.participantActionsA11y', 'Actions for {{name}}', {
                        name: s.displayName,
                      })
                    : t('room.profileA11y', 'Profile of {{name}}', { name: s.displayName })
                }
                style={[styles.speakerPress, { width: speakerWidth }]}
              >
                <SpeakerCell speaker={s} isSpeakingLive={isSpeakingLive} />
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  },
);
StageGrid.displayName = 'StageGrid';

const styles = StyleSheet.create({
  stageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  speakerPress: {
    alignItems: 'center',
  },
});

export default StageGrid;
