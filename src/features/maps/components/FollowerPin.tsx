import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated from 'react-native-reanimated';
import { Avatar } from '../../../shared/components/Avatar';
import { useAnimatedPress } from '../../../shared/hooks/useAnimatedPress';
import { colors } from '../../../shared/constants/theme';
import type { FollowerOnMap } from '../../../shared/types/domain';

const PIN_SIZE = 44;
const PIN_RADIUS = 12;
const BADGE_ICON_SIZE = 12;
const RECENTLY_ACTIVE_CUTOFF_MIN = 5;

interface FollowerPinProps {
  follower: FollowerOnMap;
}

/**
 * Avatar marker with 3 visual states matching the HTML spec:
 * - Live (in a live room):   accent ring + pulse
 * - In a room (not hosting): blue ring + mic badge
 * - Recently active:         muted ring + grayscale + "Xm ago" label
 */
export const FollowerPin: React.FC<FollowerPinProps> = memo(({ follower }) => {
  const isLive = follower.presence === 'online' && !!follower.liveRoomId;
  const isOnline = follower.presence === 'online';
  const isRecentlyActive =
    follower.presence === 'recently_active' ||
    follower.lastSeenMinutesAgo > RECENTLY_ACTIVE_CUTOFF_MIN;

  const pulse = useAnimatedPress({ pulse: isLive });

  const ringClass = isLive
    ? 'bg-accent'
    : isOnline && follower.liveRoomId
      ? 'bg-primary'
      : 'bg-outline-variant';

  return (
    <View className={`items-center ${isRecentlyActive ? 'opacity-60' : ''}`}>
      <Animated.View style={pulse.animatedStyle}>
        <View className={`p-0.5 ${ringClass}`} style={styles.ring}>
          <View style={[styles.avatarWrap, isRecentlyActive && styles.desaturated]}>
            <Avatar
              uri={follower.avatarUrl ?? undefined}
              name={follower.displayName}
              sizeValue={PIN_SIZE - 4}
              shape="rounded"
            />
            {isRecentlyActive && <View style={styles.grayscaleOverlay} pointerEvents="none" />}
          </View>
        </View>

        {isLive && (
          <View className="absolute -top-2 -right-2 bg-accent px-xs py-[1px] rounded-pill">
            <Text className="text-[9px] font-display text-accent-on-container uppercase tracking-widest">
              Live
            </Text>
          </View>
        )}

        {!isLive && follower.liveRoomId && (
          <View
            className="absolute -bottom-2 -right-2 bg-primary rounded-pill items-center justify-center border-2 border-background"
            style={styles.micBadge}
          >
            <MaterialIcons name="mic" size={BADGE_ICON_SIZE} color={colors.onPrimaryContainer} />
          </View>
        )}

        {isOnline && !follower.liveRoomId && (
          <View
            className="absolute -bottom-1 -right-1 bg-accent rounded-pill border-2 border-background"
            style={styles.onlineDot}
          />
        )}
      </Animated.View>

      {isRecentlyActive && follower.lastSeenMinutesAgo > 0 && (
        <View className="mt-xxs bg-surface-low px-sm py-[1px] rounded-pill">
          <Text className="text-[9px] font-body-bold text-ink-muted">
            {follower.lastSeenMinutesAgo}m ago
          </Text>
        </View>
      )}
    </View>
  );
});
FollowerPin.displayName = 'FollowerPin';

const styles = StyleSheet.create({
  ring: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_RADIUS,
  },
  avatarWrap: {
    width: PIN_SIZE - 4,
    height: PIN_SIZE - 4,
    borderRadius: PIN_RADIUS - 2,
    overflow: 'hidden',
  },
  micBadge: {
    width: 24,
    height: 24,
  },
  onlineDot: {
    width: 12,
    height: 12,
  },
  desaturated: {
    opacity: 0.7,
  },
  grayscaleOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 17, 46, 0.35)',
  },
});
