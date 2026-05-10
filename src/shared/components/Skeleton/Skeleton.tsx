import React, { memo, useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, radii, spacing } from '../../constants/theme';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * Animated skeleton placeholder — pulsing opacity from 0.3 → 0.7 on
 * a 1.2s loop. Drop-in replacement for loaders in feed cards, profiles,
 * and list screens.
 */
export const Skeleton: React.FC<SkeletonProps> = memo(
  ({ width = '100%', height = 16, borderRadius = radii.sm, style }) => {
    const opacity = useSharedValue(0.3);

    useEffect(() => {
      opacity.value = withRepeat(withTiming(0.7, { duration: 1200 }), -1, true);
    }, [opacity]);

    const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

    return (
      <Animated.View style={[styles.base, { width, height, borderRadius }, animStyle, style]} />
    );
  },
);
Skeleton.displayName = 'Skeleton';

/** Pre-composed skeleton matching a RoomCard layout. */
export const RoomCardSkeleton: React.FC = memo(() => (
  <View style={styles.card}>
    <Skeleton width="70%" height={14} />
    <View style={styles.cardRow}>
      <Skeleton width={32} height={32} borderRadius={16} />
      <Skeleton width={32} height={32} borderRadius={16} />
      <Skeleton width={32} height={32} borderRadius={16} />
      <View style={styles.cardSpacer} />
      <Skeleton width={60} height={12} />
    </View>
    <View style={styles.cardRow}>
      <Skeleton width={80} height={20} borderRadius={radii.xxl} />
      <Skeleton width={60} height={20} borderRadius={radii.xxl} />
    </View>
  </View>
));
RoomCardSkeleton.displayName = 'RoomCardSkeleton';

/** Pre-composed skeleton for a list of room cards. */
export const FeedSkeleton: React.FC<{ count?: number }> = memo(({ count = 4 }) => (
  <View style={styles.feedContainer}>
    {Array.from({ length: count }).map((_, i) => (
      <RoomCardSkeleton key={i} />
    ))}
  </View>
));
FeedSkeleton.displayName = 'FeedSkeleton';

/** Pre-composed skeleton for a user profile header. */
export const ProfileSkeleton: React.FC = memo(() => (
  <View style={styles.profileContainer}>
    <Skeleton width={120} height={120} borderRadius={60} />
    <Skeleton width={180} height={20} style={{ marginTop: spacing.md }} />
    <Skeleton width={100} height={14} style={{ marginTop: spacing.xs }} />
    <View style={[styles.cardRow, { marginTop: spacing.lg }]}>
      <Skeleton width={60} height={30} borderRadius={radii.sm} />
      <Skeleton width={60} height={30} borderRadius={radii.sm} />
    </View>
  </View>
));
ProfileSkeleton.displayName = 'ProfileSkeleton';

/** Notification list skeleton */
export const NotificationSkeleton: React.FC<{ count?: number }> = memo(({ count = 6 }) => (
  <View style={styles.feedContainer}>
    {Array.from({ length: count }).map((_, i) => (
      <View key={i} style={styles.notifRow}>
        <Skeleton width={40} height={40} borderRadius={20} />
        <View style={styles.notifContent}>
          <Skeleton width="90%" height={14} />
          <Skeleton width="50%" height={10} />
        </View>
      </View>
    ))}
  </View>
));
NotificationSkeleton.displayName = 'NotificationSkeleton';

export { Skeleton as default };

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceHigh,
  },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardSpacer: {
    flex: 1,
  },
  feedContainer: {
    gap: spacing.md,
    padding: spacing.xxl,
  },
  profileContainer: {
    alignItems: 'center',
    padding: spacing.xxl,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  notifContent: {
    flex: 1,
    gap: spacing.xs,
  },
});
