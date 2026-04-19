import React, { memo, useCallback } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../../shared/components/Avatar';
import { Button } from '../../../../shared/components/Button';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { SettingsStackParamList } from '../../../../core/navigation/types';
import { CURRENT_USER } from '../../../../shared/mocks/users.mock';
import { useFollow, useMe, useProfile, useUnfollow } from '../../hooks/useProfile';

type Route = RouteProp<SettingsStackParamList, 'Profile'>;

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

export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const meQuery = useMe();
  const userId = route.params?.userId ?? meQuery.data?.id ?? CURRENT_USER.id;
  const isSelf = userId === CURRENT_USER.id;

  const { data: user, isLoading, isError } = useProfile(userId);
  const follow = useFollow();
  const unfollow = useUnfollow();

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleToggleFollow = useCallback(() => {
    if (!user) return;
    if (user.isFollowedByMe) unfollow.mutate(user.id);
    else follow.mutate(user.id);
  }, [follow, unfollow, user]);
  const handleShare = useCallback(() => undefined, []);

  if (isLoading) return <Loader fullscreen accessibilityLabel="Loading profile" />;
  if (isError || !user) {
    return <EmptyState title="Profile unavailable" description="This user may not exist." />;
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={handleShare}
          accessibilityRole="button"
          accessibilityLabel="Share profile"
          hitSlop={8}
        >
          <MaterialIcons name="share" size={22} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: insets.bottom + spacing.giant,
          gap: spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-md">
          <Avatar
            uri={user.avatarUrl ?? undefined}
            name={user.displayName}
            sizeValue={120}
            status={user.isOnline ? 'online' : 'none'}
          />
          <View className="items-center gap-xxs">
            <Text className="text-xxxl font-display text-ink tracking-tight">
              {user.displayName}
            </Text>
            <Text className="text-sm font-body text-ink-muted">@{user.username}</Text>
          </View>
          {user.bio && (
            <Text className="text-sm font-body text-ink text-center leading-normal">
              {user.bio}
            </Text>
          )}

          <View className="flex-row items-center mt-sm">
            <Stat label="Following" value={formatCount(user.followingCount)} />
            <View className="w-px h-[24px] bg-overlay-white-10" />
            <Stat label="Followers" value={formatCount(user.followersCount)} />
          </View>

          {!isSelf && (
            <View className="flex-row items-center gap-sm mt-md w-full">
              <View className="flex-1">
                <Button
                  label={user.isFollowedByMe ? 'Following' : 'Follow'}
                  variant={user.isFollowedByMe ? 'ghost' : 'primary'}
                  size="md"
                  fullWidth
                  loading={follow.isPending || unfollow.isPending}
                  onPress={handleToggleFollow}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                className="w-11 h-11 rounded-pill bg-overlay-white-10 items-center justify-center"
              >
                <MaterialIcons name="chat-bubble-outline" size={18} color={colors.text} />
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
};
