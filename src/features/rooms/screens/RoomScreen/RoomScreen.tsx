import React, { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
import type {
  RoomAudioState,
  RoomParticipant,
  RoomRole,
  UserSummary,
} from '../../../../shared/types/domain';
import { useLeaveRoom, useRaiseHand, useRoom } from '../../hooks/useRooms';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Room'>;
type Route = RouteProp<RoomStackParamList, 'Room'>;

const HEADER_ICON_SIZE = 22;
const ACTION_BAR_ICON_SIZE = 18;
const ROLE_ICON_SIZE = 10;
const SPEAKER_AVATAR = 56;
const SECONDARY_AVATAR = 52;
const OTHER_AVATAR = 40;
const HAND_RAISED_MOCK_COUNT = 3;
const FOLLOWED_COUNT = 5;

const GREEN = '#00e475';

const ROLE_COLORS = {
  shield: '#22C55E',
  mic: '#22C55E',
  micOff: '#EF4444',
} as const;

type RoleIconName = 'shield' | 'mic' | 'mic-off';

const getRoleIconProps = (
  role: RoomRole,
  audio: RoomAudioState,
): { icon: RoleIconName; color: string } => {
  if (role === 'host') return { icon: 'shield', color: ROLE_COLORS.shield };
  if (audio === 'muted') return { icon: 'mic-off', color: ROLE_COLORS.micOff };
  return { icon: 'mic', color: ROLE_COLORS.mic };
};

const SpeakerCell: React.FC<{ speaker: RoomParticipant }> = memo(({ speaker }) => {
  const isSpeaking = speaker.audio === 'speaking';
  const isHost = speaker.role === 'host';
  const pulse = useAnimatedPress({ pulse: isSpeaking });
  const { icon: roleIcon, color: roleColor } = getRoleIconProps(speaker.role, speaker.audio);
  const roleLabel = isHost ? 'Host' : 'Speaker';

  return (
    <View style={styles.speakerCell}>
      <Animated.View style={[pulse.animatedStyle, styles.speakerRingWrapper]}>
        <Avatar
          uri={speaker.avatarUrl ?? undefined}
          name={speaker.displayName}
          sizeValue={SPEAKER_AVATAR}
          ring={isSpeaking}
          ringColor={GREEN}
          ringWidth={2}
        />
        {isSpeaking && (
          <View style={styles.speakerMicBadge}>
            <MaterialIcons name="graphic-eq" size={10} color="#00210b" />
          </View>
        )}
      </Animated.View>
      <Text
        className="text-[10px] font-body-bold text-white text-center"
        numberOfLines={1}
        style={styles.speakerName}
      >
        {speaker.displayName}
      </Text>
      <View className="flex-row items-center gap-xxs">
        <MaterialIcons name={roleIcon} size={ROLE_ICON_SIZE} color={roleColor} />
        <Text
          style={{ fontSize: ROLE_ICON_SIZE, lineHeight: ROLE_ICON_SIZE + 2, color: roleColor }}
          className="font-body-bold uppercase tracking-tighter"
        >
          {roleLabel}
        </Text>
      </View>
    </View>
  );
});
SpeakerCell.displayName = 'SpeakerCell';

const HandRaisedCell: React.FC<{ listener: UserSummary }> = memo(({ listener }) => (
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

const FollowedCell: React.FC<{ listener: UserSummary }> = memo(({ listener }) => (
  <View style={styles.gridCell}>
    <Avatar
      uri={listener.avatarUrl ?? undefined}
      name={listener.displayName}
      sizeValue={SECONDARY_AVATAR}
    />
  </View>
));
FollowedCell.displayName = 'FollowedCell';

const OtherCell: React.FC<{ listener: UserSummary }> = memo(({ listener }) => (
  <View style={[styles.gridCell, styles.otherCell]}>
    <Avatar
      uri={listener.avatarUrl ?? undefined}
      name={listener.displayName}
      sizeValue={OTHER_AVATAR}
    />
  </View>
));
OtherCell.displayName = 'OtherCell';

interface SectionLabelProps {
  label: string;
  emphasis?: boolean;
}

const SectionLabel: React.FC<SectionLabelProps> = memo(({ label, emphasis = false }) => (
  <View className="flex-row items-center gap-sm mb-lg px-xs">
    <Text
      className={
        emphasis
          ? 'text-[10px] font-body-bold text-accent tracking-widest uppercase'
          : 'text-[10px] font-body-bold text-ink-muted tracking-widest uppercase'
      }
    >
      {label}
    </Text>
    {emphasis && (
      <LinearGradient
        colors={['rgba(0,228,117,0.2)', 'rgba(0,228,117,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.sectionGradientLine}
      />
    )}
  </View>
));
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

  const handleWave = useCallback(() => {
    // Wire to presence wave when realtime ships.
  }, []);
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

  const handRaisedListeners = useMemo(
    () => (room ? room.listeners.slice(0, HAND_RAISED_MOCK_COUNT) : []),
    [room],
  );
  const followedListeners = useMemo(
    () => (room ? room.listeners.slice(0, FOLLOWED_COUNT) : []),
    [room],
  );
  const otherListeners = useMemo(() => (room ? room.listeners.slice(FOLLOWED_COUNT) : []), [room]);
  const othersOverflow = room ? Math.max(0, room.listenersCount - room.listeners.length) : 0;

  const actionBarBottomOffset = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.xxl;

  if (isLoading) return <Loader fullscreen accessibilityLabel="Loading room" />;
  if (isError || !room) {
    return <EmptyState title="Room unavailable" description="This room may have ended." />;
  }

  return (
    <View className="flex-1 bg-background">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <View className="flex-row items-center gap-sm">
          <MaterialIcons name="graphic-eq" size={HEADER_ICON_SIZE} color={colors.primary} />
          <Text className="text-lg font-display text-primary tracking-tighter">Chathouse</Text>
        </View>
        <Pressable
          onPress={handleWave}
          accessibilityRole="button"
          accessibilityLabel="Send a wave"
          className="bg-primary/10 border border-primary/20 px-lg py-xs rounded-pill"
        >
          <Text className="text-sm font-body-bold text-primary">Wave 👋</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingTop: insets.top + spacing.mega,
          paddingBottom: insets.bottom + actionBarBottomOffset + spacing.mega,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-huge gap-md">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-xs flex-wrap flex-1">
              {room.houseName && (
                <View className="bg-surface-highest px-sm py-xxs rounded-xs">
                  <Text className="text-[10px] font-body-bold text-ink-muted uppercase tracking-wider">
                    {room.houseName}
                  </Text>
                </View>
              )}
              <View className="bg-primary/10 px-sm py-xxs rounded-xs">
                <Text className="text-[10px] font-body-bold text-primary uppercase tracking-wider">
                  {room.categoryEmoji} {room.category}
                </Text>
              </View>
            </View>
            {room.isRecording && (
              <View className="flex-row items-center gap-xs bg-danger/20 px-sm py-xxs rounded-sm">
                <View className="w-xs h-xs rounded-pill bg-danger" />
                <Text className="text-[10px] font-body-bold text-danger tracking-widest">REC</Text>
              </View>
            )}
          </View>
          <Text className="text-display font-display text-white tracking-tight leading-tight">
            {room.title}
          </Text>
        </View>

        <View className="mb-huge">
          <SectionLabel label="⭐ STAGE" emphasis />
          <View style={styles.stageGrid}>
            {room.speakers.map(s => (
              <SpeakerCell key={s.id} speaker={s} />
            ))}
          </View>
        </View>

        {handRaisedListeners.length > 0 && (
          <View className="mb-huge">
            <SectionLabel label="Hand raised" />
            <View style={styles.handRaisedRow}>
              {handRaisedListeners.map(l => (
                <HandRaisedCell key={l.id} listener={l} />
              ))}
            </View>
          </View>
        )}

        {followedListeners.length > 0 && (
          <View className="mb-huge">
            <SectionLabel label="Followed by speakers" />
            <View style={styles.followedRow}>
              {followedListeners.map(l => (
                <FollowedCell key={l.id} listener={l} />
              ))}
            </View>
          </View>
        )}

        {(otherListeners.length > 0 || othersOverflow > 0) && (
          <View className="mb-huge">
            <SectionLabel label="Others in room" />
            <View style={styles.othersGrid}>
              {otherListeners.map(o => (
                <OtherCell key={o.id} listener={o} />
              ))}
              {othersOverflow > 0 && (
                <View style={styles.gridCell}>
                  <View style={styles.overflowChip}>
                    <Text className="text-[9px] font-body-bold text-primary">
                      +{othersOverflow}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <View
        className="absolute left-0 right-0 items-center"
        style={{ bottom: insets.bottom + actionBarBottomOffset }}
        pointerEvents="box-none"
      >
        <View style={styles.actionPill}>
          <Animated.View style={muteBtn.animatedStyle}>
            <Pressable
              onPress={handleToggleMute}
              onPressIn={muteBtn.onPressIn}
              onPressOut={muteBtn.onPressOut}
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              accessibilityState={{ selected: isMuted }}
              className="flex-row items-center gap-sm bg-danger rounded-pill py-sm px-xl"
            >
              <MaterialIcons
                name={isMuted ? 'mic-off' : 'mic'}
                size={ACTION_BAR_ICON_SIZE}
                color={colors.white}
              />
              <Text className="text-sm font-body-bold text-white">
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
              className="flex-row items-center gap-sm bg-primary/20 rounded-pill py-sm px-lg"
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
              className="flex-row items-center gap-sm border border-overlay-white-20 rounded-pill py-sm px-xl"
            >
              <MaterialIcons name="logout" size={ACTION_BAR_ICON_SIZE} color={colors.danger} />
              <Text className="text-sm font-body-bold text-white">Leave</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(7,11,40,0.35)',
  },
  sectionGradientLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  stageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  speakerCell: {
    width: '20%',
    alignItems: 'center',
    gap: spacing.xs,
  },
  speakerRingWrapper: {
    position: 'relative',
  },
  speakerMicBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: GREEN,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerName: {
    maxWidth: SPEAKER_AVATAR,
  },
  handRaisedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
  },
  handRaisedCell: {
    position: 'relative',
  },
  handEmoji: {
    position: 'absolute',
    right: -2,
    bottom: -2,
  },
  followedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  othersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  gridCell: {
    width: '20%',
    alignItems: 'center',
  },
  otherCell: {
    opacity: 0.6,
  },
  overflowChip: {
    width: OTHER_AVATAR,
    height: OTHER_AVATAR,
    borderRadius: OTHER_AVATAR / 2,
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(12,17,46,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 9999,
    padding: spacing.xs,
  },
});
