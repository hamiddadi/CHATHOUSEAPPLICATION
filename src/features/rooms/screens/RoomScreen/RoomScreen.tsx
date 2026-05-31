import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, layout, spacing } from '../../../../shared/constants/theme';
import type { RoomStackParamList } from '../../../../core/navigation/types';
import type { RoomParticipant, UserSummary } from '../../../../shared/types/domain';
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
import type { RoomListener } from '../../services/roomService';
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
import { formatScheduled } from '../../../../shared/utils/formatScheduled';
import StageGrid from './partials/StageGrid';
import HandRaiseQueue from './partials/HandRaiseQueue';
import FollowedByListeners from './partials/FollowedByListeners';
import OthersGrid from './partials/OthersGrid';
import RoomActionBar from './partials/RoomActionBar';

// Public landing URL for share-sheet messages. Universal Links (iOS) /
// App Links (Android) on this domain redirect to chathouse:// when the
// app is installed. The path MUST match the route declared in
// core/navigation/linking.ts (Room: 'room/:roomId') — `/r/<id>` matched no
// screen and silently failed to open the room.
const ROOM_SHARE_BASE_URL = 'https://app.chathouse.com/room';

type Nav = NativeStackNavigationProp<RoomStackParamList, 'Room'>;
type Route = RouteProp<RoomStackParamList, 'Room'>;

const HEADER_ICON_SIZE = 22;
const FOLLOWED_COUNT = 5;

// Pure layout constant (depends only on imported theme tokens) — hoisted so
// it isn't recomputed every render and can be shared by the inline styles.
const ACTION_BAR_BOTTOM_OFFSET = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.xxl;

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
  // Stable room id for effects that only need the identifier (not the whole
  // `room` object, which gets a fresh reference on every React Query refetch).
  const roomId = room?.id ?? null;
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
      if (!roomId || !viewerId) return;
      const socket = await getSocket();
      if (cancelled || !socket) return;
      const muteHandler = (payload: {
        userId: string;
        isMuted: boolean;
        roomId?: string;
      }): void => {
        if (payload.userId !== viewerId) return;
        if (payload.roomId && payload.roomId !== roomId) return;
        setIsMuted(payload.isMuted);
      };
      const kickHandler = (payload: { userId: string; roomId?: string }): void => {
        if (payload.userId !== viewerId) return;
        if (payload.roomId && payload.roomId !== roomId) return;
        // Pop the screen first so the user lands somewhere safe even if
        // they dismiss the alert. The 30-min RoomBan installed by the
        // backend prevents an immediate re-join.
        navigation.goBack();
        Alert.alert(
          'Vous avez été retiré',
          'Un modérateur vous a expulsé de cette room. Vous ne pouvez pas y revenir avant 30 minutes.',
        );
      };
      // The host closed the room (REST /rooms/:id/end or socket room:end).
      // A missing roomId means "this room"; otherwise it must match the one
      // we're viewing. Pop the screen and tell the user it's over.
      const endedHandler = (payload: { roomId?: string }): void => {
        if (payload.roomId && payload.roomId !== roomId) return;
        navigation.goBack();
        Alert.alert('Room terminée', "Cette room a été fermée par l'hôte.");
      };
      const roleHandler = (payload: { userId: string; role: string; roomId?: string }): void => {
        if (payload.userId !== viewerId) return;
        if (payload.roomId && payload.roomId !== roomId) return;
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
      socket.on('room:ended', endedHandler);
      cleanup = () => {
        socket.off('room:mute-changed', muteHandler);
        socket.off('room:user_kicked', kickHandler);
        socket.off('room:role_changed', roleHandler);
        socket.off('room:ended', endedHandler);
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [navigation, roomId, viewerId]);

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

  // Promote a hand-raised listener: synthesise the RoomParticipant shape the
  // moderation/profile press handler expects (the queue only carries the
  // lightweight UserSummary).
  const handlePromoteHandRaise = useCallback(
    (listener: UserSummary) => {
      handleParticipantPress({
        ...listener,
        role: 'listener',
        audio: 'idle',
        handRaised: true,
      });
    },
    [handleParticipantPress],
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
  const othersOverflow = room ? Math.max(0, room.listenersCount - room.listeners.length) : 0;

  // Partition listeners into "followed by you" vs "others" using the
  // backend-computed `followedByViewer` flag (carried on each listener by
  // roomService). When NO listener is flagged — either a legacy payload
  // without the flag, or genuinely none followed — we fall back to the
  // previous positional behaviour (first FOLLOWED_COUNT in the followed row,
  // the rest in the grid) so the layout never regresses.
  const { followedListeners, otherListeners } = useMemo(() => {
    const listeners = (room?.listeners ?? []) as RoomListener[];
    const followed = listeners.filter(l => l.followedByViewer);
    if (followed.length === 0) {
      // No flagged followers → keep the historical positional split.
      return {
        followedListeners: listeners.slice(0, FOLLOWED_COUNT),
        otherListeners: listeners.slice(FOLLOWED_COUNT),
      };
    }
    // Cap the followed row at FOLLOWED_COUNT and spill the overflow into
    // "Others" so a viewer who follows >FOLLOWED_COUNT listeners never loses
    // anyone (the followed partial only renders maxVisible avatars).
    return {
      followedListeners: followed.slice(0, FOLLOWED_COUNT),
      otherListeners: [
        ...followed.slice(FOLLOWED_COUNT),
        ...listeners.filter(l => !l.followedByViewer),
      ],
    };
  }, [room?.listeners]);

  // Live "is speaking" per speaker, keyed by speaker id. The mediasoup score
  // map keys the local user under SPEAKING_SELF_KEY; everyone else is keyed by
  // their user id. Computed here so the score graph stays in the orchestrator
  // and StageGrid stays purely presentational.
  const speakingLiveByUser = useMemo(() => {
    const map = new Map<string, boolean>();
    if (!room) return map;
    for (const s of room.speakers) {
      const key = s.id === viewerId ? SPEAKING_SELF_KEY : s.id;
      const score = audio.scores.get(key) ?? 0;
      map.set(s.id, score >= SPEAKING_SCORE_THRESHOLD && s.audio !== 'muted');
    }
    return map;
  }, [room, viewerId, audio.scores]);

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
            {room.isLive ? (
              // Only count elapsed time for a live room. `startedAt` maps to
              // createdAt, so a scheduled (not-yet-live) room would otherwise
              // show a huge bogus duration — show its scheduled time instead.
              <RoomTimer startedAt={room.startedAt} />
            ) : (
              <Text className="text-[10px] text-ink-dim">
                {room.scheduledFor ? formatScheduled(room.scheduledFor) : 'À venir'}
              </Text>
            )}
            <Text className="text-[10px] text-ink-dim">
              {room.speakersCount} speakers · {room.listenersCount} listeners
            </Text>
          </View>
        </View>

        <StageGrid
          speakers={room.speakers}
          speakingLiveByUser={speakingLiveByUser}
          viewerCanModerate={viewerCanModerate}
          onParticipantPress={handleParticipantPress}
        />

        <HandRaiseQueue
          handRaises={handRaisedUsers}
          viewerCanModerate={viewerCanModerate}
          onPromote={handlePromoteHandRaise}
        />

        <FollowedByListeners
          participants={followedListeners}
          maxVisible={FOLLOWED_COUNT}
          onTap={handleListenerPress}
        />

        <OthersGrid
          participants={otherListeners}
          overflow={othersOverflow}
          onTap={handleListenerPress}
        />
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
        <RoomActionBar
          viewerCanSpeak={viewerCanSpeak}
          isMuted={isMuted}
          isHandRaised={isHandRaised}
          onToggleMute={handleToggleMute}
          onToggleHand={handleToggleHand}
          onInvite={() => navigation.navigate('InviteToRoom', { roomId: room.id })}
          onLeave={handleLeave}
        />
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
  reactionsWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
