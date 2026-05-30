import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
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
import {
  useEndRoom,
  useHandRaises,
  useLeaveRoom,
  useLowerHand,
  useRaiseHand,
  useReportRoom,
  useRoom,
  useSetMute,
} from '../../hooks/useRooms';
import { useRoomSocket } from '../../hooks/useRoomSocket';
import {
  SPEAKING_SCORE_THRESHOLD,
  SPEAKING_SELF_KEY,
  useRoomAudio,
} from '../../hooks/useRoomAudio';
import { HostActionsSheet } from '../../components/HostActionsSheet';
import { RoomChatSidebar } from '../../components/RoomChatSidebar';
import { ReactionsBar } from '../../components/ReactionsBar';
import { ProfileActionSheet } from '../../components/ProfileActionSheet';
import { RoomControlsSheet } from '../../components/RoomControlsSheet';
import { TitleEditModal } from '../../components/TitleEditModal';
import { RoomTimer } from '../../components/RoomTimer';
import { useAuthStore } from '../../../auth/store/authStore';
import { getSocket } from '../../../../shared/services/realtime/socketClient';

// Public landing URL for share-sheet messages. Universal Links (iOS) /
// App Links (Android) on this domain redirect to chathouse:// when the
// app is installed; the prefixes are declared in core/navigation/linking.ts.
const ROOM_SHARE_BASE_URL = 'https://app.chathouse.com/r';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Room'>;
type Route = RouteProp<RoomStackParamList, 'Room'>;

const HEADER_ICON_SIZE = 22;
const ACTION_BAR_ICON_SIZE = 18;
const ROLE_ICON_SIZE = 10;
const SPEAKER_AVATAR = 56;
const SECONDARY_AVATAR = 52;
const OTHER_AVATAR = 40;
const FOLLOWED_COUNT = 5;

// Pure layout constant (depends only on imported theme tokens) — hoisted so
// it isn't recomputed every render and can be shared by the inline styles.
const ACTION_BAR_BOTTOM_OFFSET = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.xxl;

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

const SpeakerCell: React.FC<{ speaker: RoomParticipant; isSpeakingLive?: boolean }> = memo(
  ({ speaker, isSpeakingLive = false }) => {
    // Live "is speaking" comes from mediasoup score broadcasts when audio is
    // active; `speaker.audio === 'speaking'` is a static fallback for the
    // unsupported case (no audio engine).
    const isSpeaking = isSpeakingLive || speaker.audio === 'speaking';
    const isHost = speaker.role === 'host';
    const pulse = useAnimatedPress({ pulse: isSpeaking });
    const { icon: roleIcon, color: roleColor } = getRoleIconProps(speaker.role, speaker.audio);
    const { t } = useTranslation();
    const roleLabel = isHost ? t('room.host') : t('room.speaker');

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
  },
);
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
  const lowerHand = useLowerHand();
  const setMute = useSetMute();
  const endRoom = useEndRoom();
  const reportRoom = useReportRoom();
  const viewerId = useAuthStore(s => s.user?.id ?? null);
  const { data: handRaises = [] } = useHandRaises(room?.id ?? null);
  const [actionTarget, setActionTarget] = useState<RoomParticipant | null>(null);
  // Listener taps surface a profile sheet (follow / wave / ping); host taps
  // surface the moderation sheet (kick / promote / etc). These two states
  // are mutually exclusive — the press handler picks based on viewer role.
  const [profileTarget, setProfileTarget] = useState<UserSummary | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [titleEditOpen, setTitleEditOpen] = useState(false);

  // Determine the viewer's privileges in this room. The room object only
  // exposes `host` (id match) and the participants list; we look up the
  // current user there to decide whether to surface the host actions sheet.
  const viewerRole = useMemo(() => {
    if (!room || !viewerId) return null;
    const participant = room.speakers.find(s => s.id === viewerId);
    return participant?.role ?? null;
  }, [room, viewerId]);
  const viewerIsHost = Boolean(room && viewerId && room.hostId === viewerId);
  const viewerCanModerate = viewerIsHost || viewerRole === 'moderator';
  // The mic button only makes sense for users with publishing rights
  // (Agora "Broadcaster"). Listeners are "Audience" and silently produce
  // nothing — showing a Mute button to them would be a dead control.
  const viewerCanSpeak = Boolean(
    viewerRole && (viewerRole === 'host' || viewerRole === 'moderator' || viewerRole === 'speaker'),
  );

  // Subscribe to room broadcasts (user-joined, hand_raised, role_changed,
  // mute-changed, kicked, ended). Without this, the screen is static and
  // never reflects what other participants do.
  useRoomSocket(room?.id ?? null);

  // Capture mic + start producing once we're in the room. The Agora
  // engine auto-activates if `react-native-agora` is installed; in Expo
  // Go it returns `status: 'unsupported'` and the rest of the screen
  // (chat, hand-raise, reactions) keeps working.
  const audio = useRoomAudio({ roomId: room?.id ?? null, enabled: Boolean(room) });

  // Sync the local mute icon when the host force-mutes us, AND react to
  // a kick targeting us. Both events are server-side broadcasts; the
  // client filters on `userId === viewerId`.
  //
  // Race-safety: `getSocket()` is async, so the component can unmount
  // BEFORE the socket resolves. Without a cancelled flag, we'd register
  // the listener after unmount, the cleanup would be `undefined`, and
  // the handler would leak (forever firing into a dead component). The
  // flag check before `socket.on` is what closes that hole.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      if (!room || !viewerId) return;
      const socket = await getSocket();
      if (cancelled || !socket) return;
      const muteHandler = (payload: {
        userId: string;
        isMuted: boolean;
        roomId?: string;
      }): void => {
        if (payload.userId !== viewerId) return;
        if (payload.roomId && payload.roomId !== room.id) return;
        setIsMuted(payload.isMuted);
      };
      const kickHandler = (payload: { userId: string; roomId?: string }): void => {
        if (payload.userId !== viewerId) return;
        if (payload.roomId && payload.roomId !== room.id) return;
        // Pop the screen first so the user lands somewhere safe even if
        // they dismiss the alert. The 30-min RoomBan installed by the
        // backend prevents an immediate re-join.
        navigation.goBack();
        Alert.alert(
          'Vous avez été retiré',
          'Un modérateur vous a expulsé de cette room. Vous ne pouvez pas y revenir avant 30 minutes.',
        );
      };
      const roleHandler = (payload: { userId: string; role: string; roomId?: string }): void => {
        if (payload.userId !== viewerId) return;
        if (payload.roomId && payload.roomId !== room.id) return;
        // Promotion to a publishing role — celebrate locally so the user
        // notices the new mic button before they wonder where it came from.
        if (payload.role === 'SPEAKER' || payload.role === 'MODERATOR' || payload.role === 'HOST') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Sur la scène 🎙️',
            payload.role === 'HOST'
              ? "Vous êtes maintenant l'hôte de la room."
              : payload.role === 'MODERATOR'
                ? 'Vous êtes désormais modérateur.'
                : 'Vous pouvez parler — appuyez sur Mute pour activer votre micro.',
          );
        }
      };
      socket.on('room:mute-changed', muteHandler);
      socket.on('room:user_kicked', kickHandler);
      socket.on('room:role_changed', roleHandler);
      cleanup = () => {
        socket.off('room:mute-changed', muteHandler);
        socket.off('room:user_kicked', kickHandler);
        socket.off('room:role_changed', roleHandler);
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [navigation, room, viewerId]);

  const muteBtn = useAnimatedPress({ scaleTo: 0.96 });
  const raiseBtn = useAnimatedPress({ scaleTo: 0.96 });
  const leaveBtn = useAnimatedPress({ scaleTo: 0.96 });
  const { t } = useTranslation();

  const handleToggleMute = useCallback(async () => {
    if (!room) return;
    const next = !isMuted;
    // Optimistic flip — the badge follows the press immediately. Backend
    // is the source of truth: if it rejects, we roll back. The Agora
    // mute is fire-and-forget and not awaited because it's local — its
    // failure shouldn't drag down the API success.
    setIsMuted(next);
    void audio.setMuted(next);
    try {
      await setMute.mutateAsync({ roomId: room.id, isMuted: next });
    } catch {
      // Backend refused — undo both the badge AND Agora to keep them
      // consistent.
      setIsMuted(!next);
      void audio.setMuted(!next);
    }
  }, [audio, isMuted, room, setMute]);
  const handleToggleHand = useCallback(() => {
    if (!room) return;
    const next = !isHandRaised;
    setIsHandRaised(next);
    const mutation = next ? raiseHand : lowerHand;
    mutation.mutate(room.id, {
      onError: () => setIsHandRaised(!next),
    });
  }, [isHandRaised, lowerHand, raiseHand, room]);
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

  const handleEndRoom = useCallback(() => {
    if (!room) return;
    Alert.alert(
      'Fermer la room',
      `"${room.title}" sera fermée pour tous les participants. Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Fermer',
          style: 'destructive',
          onPress: () => endRoom.mutate(room.id, { onSettled: () => navigation.goBack() }),
        },
      ],
    );
  }, [endRoom, navigation, room]);

  const handleReportRoom = useCallback(() => {
    if (!room) return;
    Alert.alert('Signaler cette room', 'Quelle est la raison ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Spam', onPress: () => reportRoom.mutate({ roomId: room.id, reason: 'spam' }) },
      {
        text: 'Harcèlement',
        onPress: () => reportRoom.mutate({ roomId: room.id, reason: 'harassment' }),
      },
      { text: 'Autre', onPress: () => reportRoom.mutate({ roomId: room.id, reason: 'other' }) },
    ]);
  }, [reportRoom, room]);

  const handleParticipantPress = useCallback(
    (participant: RoomParticipant) => {
      if (participant.id === viewerId) return; // ignore self-taps
      // Host/mod path: surface moderation actions. Listener path: surface
      // social actions (follow / ping / wave / open profile).
      if (viewerCanModerate) {
        setActionTarget(participant);
      } else {
        setProfileTarget({
          id: participant.id,
          username: participant.username,
          displayName: participant.displayName,
          avatarUrl: participant.avatarUrl,
        });
      }
    },
    [viewerCanModerate, viewerId],
  );

  const handleListenerPress = useCallback(
    (listener: UserSummary) => {
      if (listener.id === viewerId) return;
      setProfileTarget(listener);
    },
    [viewerId],
  );

  const handleShare = useCallback(async () => {
    if (!room) return;
    try {
      await Share.share({
        title: room.title,
        message: `Rejoins-moi sur Chathouse : "${room.title}" — ${ROOM_SHARE_BASE_URL}/${room.id}`,
        url: `${ROOM_SHARE_BASE_URL}/${room.id}`,
      });
    } catch {
      /* user cancelled — no-op */
    }
  }, [room]);

  // Real hand-raise queue from the API. We render avatars for every queued
  // user; tapping one promotes them to SPEAKER (host/mod only).
  const handRaisedUsers = useMemo<UserSummary[]>(
    () =>
      handRaises.map(h => ({
        id: h.id,
        username: h.username,
        displayName: h.displayName,
        avatarUrl: h.avatarUrl,
      })),
    [handRaises],
  );
  const followedListeners = useMemo(
    () => (room ? room.listeners.slice(0, FOLLOWED_COUNT) : []),
    [room],
  );
  const otherListeners = useMemo(() => (room ? room.listeners.slice(FOLLOWED_COUNT) : []), [room]);
  const othersOverflow = room ? Math.max(0, room.listenersCount - room.listeners.length) : 0;

  if (isLoading) return <Loader fullscreen accessibilityLabel={t('common.loading')} />;
  if (isError || !room) {
    return <EmptyState title={t('room.unavailable')} description={t('room.mayHaveEnded')} />;
  }

  return (
    <View className="flex-1 bg-background">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <View className="flex-row items-center gap-sm">
          <MaterialIcons name="graphic-eq" size={HEADER_ICON_SIZE} color={colors.primary} />
          <Text className="text-lg font-display text-primary tracking-tighter">Chathouse</Text>
        </View>
        <View className="flex-row items-center gap-xs">
          <Pressable
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel="Partager le lien de la room"
            hitSlop={8}
            className="w-9 h-9 items-center justify-center rounded-pill bg-overlay-white-5"
          >
            <MaterialIcons name="ios-share" size={18} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => setChatOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Ouvrir le chat"
            hitSlop={8}
            className="w-9 h-9 items-center justify-center rounded-pill bg-overlay-white-5"
          >
            <MaterialIcons name="chat" size={18} color={colors.text} />
          </Pressable>
          {viewerCanModerate && (
            <Pressable
              onPress={() => setControlsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Contrôles de la room"
              hitSlop={8}
              className="w-9 h-9 items-center justify-center rounded-pill bg-overlay-white-5"
            >
              <MaterialIcons name="tune" size={18} color={colors.text} />
            </Pressable>
          )}
          {!viewerIsHost && (
            <Pressable
              onPress={handleReportRoom}
              accessibilityRole="button"
              accessibilityLabel="Signaler cette room"
              hitSlop={8}
              className="w-9 h-9 items-center justify-center rounded-pill bg-overlay-white-5"
            >
              <MaterialIcons name="flag" size={18} color={colors.textMuted} />
            </Pressable>
          )}
          {viewerIsHost && (
            <Pressable
              onPress={handleEndRoom}
              accessibilityRole="button"
              accessibilityLabel="Fermer la room"
              hitSlop={8}
              className="bg-danger/15 border border-danger/30 px-lg py-xs rounded-pill"
            >
              <Text className="text-sm font-body-bold text-danger">Fermer</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingTop: insets.top + spacing.mega,
          paddingBottom: insets.bottom + ACTION_BAR_BOTTOM_OFFSET + spacing.mega,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Audio status banner — driven by the Agora engine state. We
            only render it for non-live states so a healthy room has an
            uncluttered top section. */}
        {audio.status !== 'live' && audio.status !== 'idle' ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion={audio.status === 'error' ? 'assertive' : 'polite'}
            className={
              audio.status === 'error'
                ? 'mb-xl px-md py-sm rounded-md bg-danger/10 border border-danger/30'
                : audio.status === 'unsupported'
                  ? 'mb-xl px-md py-sm rounded-md bg-warning/10 border border-warning/30'
                  : 'mb-xl px-md py-sm rounded-md bg-primary/10 border border-primary/20'
            }
          >
            <Text
              className={
                audio.status === 'error'
                  ? 'text-xs font-body-medium text-danger text-center'
                  : audio.status === 'unsupported'
                    ? 'text-xs font-body-medium text-warning text-center'
                    : 'text-xs font-body-medium text-primary text-center'
              }
            >
              {audio.status === 'connecting'
                ? '🔊 Connexion à Agora…'
                : audio.status === 'unsupported'
                  ? '⚠️ Audio nécessite un dev-client EAS (react-native-agora indisponible en Expo Go)'
                  : audio.status === 'error'
                    ? `❌ ${audio.error ?? 'Erreur audio'}`
                    : t('room.audioBanner')}
            </Text>
          </View>
        ) : null}

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
                <Text className="text-[10px] font-body-bold text-danger tracking-widest">
                  {t('room.rec')}
                </Text>
              </View>
            )}
          </View>
          <Pressable
            onPress={viewerCanModerate ? () => setTitleEditOpen(true) : undefined}
            disabled={!viewerCanModerate}
            accessibilityRole={viewerCanModerate ? 'button' : 'header'}
            accessibilityLabel={
              viewerCanModerate ? `Modifier le titre : ${room.title}` : room.title
            }
          >
            <Text className="text-display font-display text-white tracking-tight leading-tight">
              {room.title}
            </Text>
          </Pressable>
          <View className="flex-row items-center gap-sm mt-xs">
            <RoomTimer startedAt={room.startedAt} />
            <Text className="text-[10px] text-ink-dim">
              {room.speakersCount} speakers · {room.listenersCount} listeners
            </Text>
          </View>
        </View>

        <View className="mb-huge">
          <SectionLabel label={`⭐ ${t('room.stage')}`} emphasis />
          <View style={styles.stageGrid}>
            {room.speakers.map(s => {
              const key = s.id === viewerId ? SPEAKING_SELF_KEY : s.id;
              const score = audio.scores.get(key) ?? 0;
              const isSpeakingLive = score >= SPEAKING_SCORE_THRESHOLD && s.audio !== 'muted';
              return (
                <Pressable
                  key={s.id}
                  onPress={() => handleParticipantPress(s)}
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

        {handRaisedUsers.length > 0 && (
          <View className="mb-huge">
            <SectionLabel label={`${t('room.handRaised')} · ${handRaisedUsers.length}`} />
            <View style={styles.handRaisedRow}>
              {handRaisedUsers.map(l => (
                <Pressable
                  key={l.id}
                  onPress={() =>
                    handleParticipantPress({
                      ...l,
                      role: 'listener',
                      audio: 'idle',
                      handRaised: true,
                    })
                  }
                  accessibilityRole={viewerCanModerate ? 'button' : undefined}
                  accessibilityLabel={
                    viewerCanModerate ? `Inviter ${l.displayName} à parler` : l.displayName
                  }
                >
                  <HandRaisedCell listener={l} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {followedListeners.length > 0 && (
          <View className="mb-huge">
            <SectionLabel label={t('room.followedBy')} />
            <View style={styles.followedRow}>
              {followedListeners.map(l => (
                <Pressable
                  key={l.id}
                  onPress={() => handleListenerPress(l)}
                  accessibilityRole="button"
                  accessibilityLabel={`Profil de ${l.displayName ?? l.username}`}
                >
                  <FollowedCell listener={l} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {(otherListeners.length > 0 || othersOverflow > 0) && (
          <View className="mb-huge">
            <SectionLabel label={t('room.others')} />
            <View style={styles.othersGrid}>
              {otherListeners.map(o => (
                <Pressable
                  key={o.id}
                  onPress={() => handleListenerPress(o)}
                  accessibilityRole="button"
                  accessibilityLabel={`Profil de ${o.displayName ?? o.username}`}
                >
                  <OtherCell listener={o} />
                </Pressable>
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

      {/* Floating reactions bar — sits just above the action pill so the
          float-up emojis fly in front of the controls. pointerEvents
          'box-none' on the wrapper lets taps on the action pill pass
          through the float layer. */}
      <View
        style={[styles.reactionsWrapper, { bottom: insets.bottom + ACTION_BAR_BOTTOM_OFFSET + 60 }]}
        pointerEvents="box-none"
      >
        <ReactionsBar roomId={room.id} />
      </View>

      <View
        className="absolute left-0 right-0 items-center"
        style={{ bottom: insets.bottom + ACTION_BAR_BOTTOM_OFFSET }}
        pointerEvents="box-none"
      >
        <View style={styles.actionPill}>
          {viewerCanSpeak ? (
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
                  {isMuted ? t('room.unmute') : t('room.mute')}
                </Text>
              </Pressable>
            </Animated.View>
          ) : null}

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
                {isHandRaised ? t('room.lower') : t('room.raise')}
              </Text>
            </Pressable>
          </Animated.View>

          <Animated.View style={leaveBtn.animatedStyle}>
            <Pressable
              onPress={handleLeave}
              onPressIn={leaveBtn.onPressIn}
              onPressOut={leaveBtn.onPressOut}
              accessibilityRole="button"
              accessibilityLabel={t('room.leave')}
              className="flex-row items-center gap-sm border border-overlay-white-20 rounded-pill py-sm px-xl"
            >
              <MaterialIcons name="logout" size={ACTION_BAR_ICON_SIZE} color={colors.danger} />
              <Text className="text-sm font-body-bold text-white">{t('room.leave')}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>

      <HostActionsSheet
        target={actionTarget}
        roomId={room.id}
        viewerIsHost={viewerIsHost}
        onClose={() => setActionTarget(null)}
      />
      <ProfileActionSheet
        target={profileTarget}
        roomId={room.id}
        viewerId={viewerId}
        onClose={() => setProfileTarget(null)}
      />
      <RoomChatSidebar visible={chatOpen} roomId={room.id} onClose={() => setChatOpen(false)} />
      <RoomControlsSheet
        visible={controlsOpen}
        roomId={room.id}
        chatEnabled={room.chatEnabled}
        chatVisibility={room.chatVisibility}
        onClose={() => setControlsOpen(false)}
        onEditTitle={() => setTitleEditOpen(true)}
        onInvite={() => navigation.navigate('InviteToRoom', { roomId: room.id })}
      />
      <TitleEditModal
        visible={titleEditOpen}
        roomId={room.id}
        initialTitle={room.title}
        onClose={() => setTitleEditOpen(false)}
      />
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
    width: '100%',
    alignItems: 'center',
    gap: spacing.xs,
  },
  speakerPress: {
    width: '20%',
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
  reactionsWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
