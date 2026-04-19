import React, { memo, useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { Avatar } from '../../../../shared/components/Avatar';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { useAnimatedPress } from '../../../../shared/hooks/useAnimatedPress';
import { colors, layout, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { RoomParticipant, UserSummary } from '../../../../shared/types/domain';
import { useLeaveRoom, useRaiseHand, useRoom } from '../../hooks/useRooms';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Room'>;
type Route = RouteProp<RoomStackParamList, 'Room'>;

const ACTION_BAR_ICON_SIZE = 20;
const ROLE_ICON_SIZE = 10;
const IS_MODERATOR = true;
const FOLLOWED_COUNT = 5;

const SpeakerCell: React.FC<{ speaker: RoomParticipant }> = memo(({ speaker }) => {
  const pulse = useAnimatedPress({ pulse: speaker.audio === 'speaking' });
  const roleIcon: 'shield' | 'mic-off' | 'mic' =
    speaker.role === 'host' ? 'shield' : speaker.audio === 'muted' ? 'mic-off' : 'mic';
  return (
    <View className="items-center gap-xs w-[64px]">
      <Animated.View style={pulse.animatedStyle}>
        <Avatar
          uri={speaker.avatarUrl ?? undefined}
          name={speaker.displayName}
          size="lg"
          status={speaker.audio === 'speaking' ? 'speaking' : 'none'}
        />
      </Animated.View>
      <Text className="text-xxs font-body-bold text-white text-center" numberOfLines={1}>
        {speaker.displayName}
      </Text>
      <View className="flex-row items-center gap-xxs opacity-60">
        <MaterialIcons name={roleIcon} size={ROLE_ICON_SIZE} color={colors.textMuted} />
        <Text className="text-xxs font-body-medium text-ink-muted uppercase tracking-tighter">
          {speaker.role === 'host' ? 'Host' : 'Speaker'}
        </Text>
      </View>
    </View>
  );
});
SpeakerCell.displayName = 'SpeakerCell';

interface ListenerCellProps {
  listener: UserSummary;
  size?: 'sm' | 'md';
  faded?: boolean;
  handRaised?: boolean;
}

const ListenerCell: React.FC<ListenerCellProps> = memo(
  ({ listener, size = 'md', faded = false, handRaised = false }) => (
    <View className={faded ? 'opacity-60' : undefined}>
      <View className="relative">
        <Avatar uri={listener.avatarUrl ?? undefined} name={listener.displayName} size={size} />
        {handRaised && (
          <View className="absolute -bottom-xxs -right-xxs">
            <Text className="text-xxs">👋</Text>
          </View>
        )}
      </View>
    </View>
  ),
);
ListenerCell.displayName = 'ListenerCell';

const SectionLabel: React.FC<{ label: string; emphasis?: boolean }> = memo(
  ({ label, emphasis = false }) => (
    <View className="flex-row items-center gap-sm mb-lg">
      <Text
        className={
          emphasis
            ? 'text-xxs font-body-bold text-accent tracking-widest uppercase'
            : 'text-xxs font-body-bold text-ink-muted tracking-widest uppercase'
        }
      >
        {label}
      </Text>
      <View className="h-px flex-1 bg-overlay-white-5" />
    </View>
  ),
);
SectionLabel.displayName = 'SectionLabel';

export const RoomScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const [isMuted, setIsMuted] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);

  const { data: room, isLoading, isError } = useRoom(route.params.roomId);
  const leaveRoom = useLeaveRoom();
  const raiseHand = useRaiseHand();

  const muteBtn = useAnimatedPress({ scaleTo: 0.96 });
  const raiseBtn = useAnimatedPress({ scaleTo: 0.96 });
  const leaveBtn = useAnimatedPress({ scaleTo: 0.96 });

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleToggleMute = useCallback(() => setIsMuted(prev => !prev), []);
  const handleToggleHand = useCallback(() => {
    setIsHandRaised(prev => !prev);
    if (room) raiseHand.mutate(room.id);
  }, [raiseHand, room]);
  const handleLeave = useCallback(async () => {
    if (room) {
      try {
        await leaveRoom.mutateAsync(room.id);
      } catch {
        // fall through to goBack regardless
      }
    }
    navigation.goBack();
  }, [leaveRoom, navigation, room]);

  const actionBarBottom = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.xxxl;

  if (isLoading) {
    return <Loader fullscreen accessibilityLabel="Loading room" />;
  }
  if (isError || !room) {
    return <EmptyState title="Room unavailable" description="This room may have ended." />;
  }

  const listenersCount = room.listeners.length;
  const followedListeners = room.listeners.slice(0, FOLLOWED_COUNT);
  const otherListeners = room.listeners.slice(FOLLOWED_COUNT);
  const othersOverflow = Math.max(0, room.listenersCount - listenersCount);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back to feed"
          hitSlop={8}
        >
          <MaterialIcons name="keyboard-arrow-down" size={28} color={colors.text} />
        </Pressable>
        <Text className="text-sm font-body-bold text-ink-muted" numberOfLines={1}>
          {room.houseName ?? 'Chathouse'}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Room options" hitSlop={8}>
          <MaterialIcons name="more-vert" size={24} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingBottom: actionBarBottom + spacing.huge,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-huge gap-md">
          <View className="flex-row items-center gap-sm">
            <View className="bg-surface-highest px-sm py-xxs rounded-xs">
              <Text className="text-xxs font-body-bold text-ink-muted uppercase tracking-wider">
                {room.categoryEmoji} {room.category}
              </Text>
            </View>
            {room.isRecording && (
              <View className="flex-row items-center gap-xs bg-danger/20 px-sm py-xxs rounded-sm">
                <View className="w-xs h-xs rounded-pill bg-danger" />
                <Text className="text-xxs font-display text-danger tracking-widest">REC</Text>
              </View>
            )}
          </View>
          <Text className="text-display font-display text-white tracking-tight leading-tight">
            {room.title}
          </Text>
        </View>

        <View className="mb-huge">
          <SectionLabel label="⭐ STAGE" emphasis />
          <View className="flex-row flex-wrap gap-lg justify-center">
            {room.speakers.map(s => (
              <SpeakerCell key={s.id} speaker={s} />
            ))}
            {IS_MODERATOR && (
              <View className="items-center gap-xs w-[64px]">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Invite a listener to the stage"
                  className="w-[56px] h-[56px] rounded-pill bg-overlay-white-5 border border-dashed border-overlay-white-30 items-center justify-center"
                >
                  <MaterialIcons name="add" size={24} color={colors.text} />
                </Pressable>
                <Text className="text-xxs font-body-medium text-ink-muted">Add</Text>
              </View>
            )}
          </View>
        </View>

        {followedListeners.length > 0 && (
          <View className="mb-huge">
            <SectionLabel label="Followed by speakers" />
            <View className="flex-row gap-md flex-wrap">
              {followedListeners.map(f => (
                <ListenerCell key={f.id} listener={f} size="md" />
              ))}
            </View>
          </View>
        )}

        {(otherListeners.length > 0 || othersOverflow > 0) && (
          <View className="mb-huge">
            <SectionLabel label="Others in room" />
            <View className="flex-row gap-sm flex-wrap justify-center">
              {otherListeners.map(o => (
                <ListenerCell key={o.id} listener={o} size="sm" faded />
              ))}
              {othersOverflow > 0 && (
                <View className="w-[40px] h-[40px] rounded-pill bg-surface-high items-center justify-center border border-overlay-white-10">
                  <Text className="text-xxs font-body-bold text-primary">+{othersOverflow}</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <View
        className="absolute left-0 right-0 items-center"
        style={{ bottom: insets.bottom + actionBarBottom }}
        pointerEvents="box-none"
      >
        <View className="flex-row items-center gap-sm bg-surface-lowest/90 border border-overlay-white-10 rounded-pill p-xs">
          <Animated.View style={muteBtn.animatedStyle}>
            <Pressable
              onPress={handleToggleMute}
              onPressIn={muteBtn.onPressIn}
              onPressOut={muteBtn.onPressOut}
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              accessibilityState={{ selected: isMuted }}
              className={
                isMuted
                  ? 'flex-row items-center gap-sm bg-danger rounded-pill py-md px-xl'
                  : 'flex-row items-center gap-sm bg-primary-container rounded-pill py-md px-xl'
              }
            >
              <MaterialIcons
                name={isMuted ? 'mic-off' : 'mic'}
                size={ACTION_BAR_ICON_SIZE}
                color={isMuted ? colors.white : colors.onPrimaryContainer}
              />
              <Text
                className={
                  isMuted
                    ? 'text-sm font-body-bold text-white'
                    : 'text-sm font-body-bold text-primary-on-container'
                }
              >
                {isMuted ? 'Unmute' : 'Mute'}
              </Text>
            </Pressable>
          </Animated.View>

          <Animated.View style={raiseBtn.animatedStyle}>
            <Pressable
              onPress={handleToggleHand}
              onPressIn={raiseBtn.onPressIn}
              onPressOut={raiseBtn.onPressOut}
              accessibilityRole="button"
              accessibilityLabel={isHandRaised ? 'Lower hand' : 'Raise hand'}
              accessibilityState={{ selected: isHandRaised }}
              className="flex-row items-center gap-sm bg-overlay-white-10 rounded-pill py-md px-lg"
            >
              <MaterialIcons name="pan-tool" size={ACTION_BAR_ICON_SIZE} color={colors.primary} />
              <Text className="text-sm font-body-bold text-primary">
                {isHandRaised ? 'Lower' : 'Raise'}
              </Text>
            </Pressable>
          </Animated.View>

          <Animated.View style={leaveBtn.animatedStyle}>
            <Pressable
              onPress={handleLeave}
              onPressIn={leaveBtn.onPressIn}
              onPressOut={leaveBtn.onPressOut}
              accessibilityRole="button"
              accessibilityLabel="Leave room quietly"
              className="flex-row items-center gap-sm border border-overlay-white-30 rounded-pill py-md px-xl"
            >
              <MaterialIcons name="logout" size={ACTION_BAR_ICON_SIZE} color={colors.white} />
              <Text className="text-sm font-body-bold text-white">Leave</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
};
