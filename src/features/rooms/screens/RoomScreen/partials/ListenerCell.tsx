import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../../../../shared/components/Avatar';
import type { UserSummary } from '../../../../../shared/types/domain';

const SECONDARY_AVATAR = 52;
const OTHER_AVATAR = 40;

export const HandRaisedCell: React.FC<{ listener: UserSummary }> = memo(({ listener }) => (
  <View style={styles.gridCell}>
    <View style={styles.handRaisedCell}>
      <Avatar
        uri={listener.avatarUrl ?? undefined}
        name={listener.displayName}
        sizeValue={SECONDARY_AVATAR}
      />
      <View style={styles.handEmoji} pointerEvents="none">
        <Text className="text-sm">👋</Text>
      </View>
    </View>
  </View>
));
HandRaisedCell.displayName = 'HandRaisedCell';

export const FollowedCell: React.FC<{ listener: UserSummary }> = memo(({ listener }) => (
  <View style={styles.gridCell}>
    <Avatar
      uri={listener.avatarUrl ?? undefined}
      name={listener.displayName}
      sizeValue={SECONDARY_AVATAR}
    />
  </View>
));
FollowedCell.displayName = 'FollowedCell';

export const OtherCell: React.FC<{ listener: UserSummary }> = memo(({ listener }) => (
  <View style={[styles.gridCell, styles.otherCell]}>
    <Avatar
      uri={listener.avatarUrl ?? undefined}
      name={listener.displayName}
      sizeValue={OTHER_AVATAR}
    />
  </View>
));
OtherCell.displayName = 'OtherCell';

const styles = StyleSheet.create({
  gridCell: {
    width: '20%',
    alignItems: 'center',
  },
  otherCell: {
    opacity: 0.6,
  },
  handRaisedCell: {
    position: 'relative',
  },
  handEmoji: {
    position: 'absolute',
    right: -2,
    bottom: -2,
  },
});
