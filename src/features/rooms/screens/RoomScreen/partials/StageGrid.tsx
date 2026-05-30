import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
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

const StageGrid: React.FC<StageGridProps> = memo(
  ({ speakers, speakingLiveByUser, viewerCanModerate, onParticipantPress }) => {
    const { t } = useTranslation();
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
                accessibilityRole={viewerCanModerate ? 'button' : undefined}
                accessibilityLabel={
                  viewerCanModerate ? `Actions pour ${s.displayName}` : s.displayName
                }
                style={styles.speakerPress}
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
    width: '20%',
  },
});

export default StageGrid;
