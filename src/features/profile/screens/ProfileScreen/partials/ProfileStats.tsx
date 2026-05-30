import React, { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

const Stat: React.FC<{ label: string; value: string; onPress?: () => void }> = memo(
  ({ label, value, onPress }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      className="items-center px-md"
    >
      <Text className="text-xl font-display text-ink">{value}</Text>
      <Text className="text-xxs font-body text-ink-muted uppercase tracking-wider">{label}</Text>
    </Pressable>
  ),
);
Stat.displayName = 'Stat';

const formatCount = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
};

interface ProfileStatsProps {
  followingCount: number;
  followersCount: number;
}

const ProfileStats: React.FC<ProfileStatsProps> = memo(({ followingCount, followersCount }) => (
  <View className="flex-row items-center mt-sm">
    <Stat label="Following" value={formatCount(followingCount)} />
    <View className="w-px h-[24px] bg-overlay-white-10" />
    <Stat label="Followers" value={formatCount(followersCount)} />
  </View>
));
ProfileStats.displayName = 'ProfileStats';

export default ProfileStats;
