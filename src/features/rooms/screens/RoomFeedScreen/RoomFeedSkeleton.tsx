import React, { memo } from 'react';
import { View } from 'react-native';
import { FeedSkeleton } from '../../../../shared/components/Skeleton';

/**
 * First-load placeholder for the RoomFeed — renders ~4 RoomCard-shaped
 * pulsing skeletons instead of a full-screen spinner so the screen keeps
 * its visual structure while the scored feed is fetched.
 *
 * Composes the shared {@link FeedSkeleton} (which already lays out four
 * RoomCard-sized cards with the feed's horizontal padding) and is shown
 * only when `isLoading` with an empty cache.
 */
export const RoomFeedSkeleton: React.FC<{ count?: number }> = memo(({ count = 4 }) => (
  <View accessibilityLabel="Loading live rooms" accessibilityRole="progressbar">
    <FeedSkeleton count={count} />
  </View>
));
RoomFeedSkeleton.displayName = 'RoomFeedSkeleton';
