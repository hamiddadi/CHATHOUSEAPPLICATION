import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';
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
import { useCurrentRoomStore } from '../../store/currentRoomStore';
import { getSocket } from '../../../../shared/services/realtime/socketClient';
import { formatScheduled } from '../../../../shared/utils/formatScheduled';
import StageGrid from './partials/StageGrid';
import HandRaiseQueue from './partials/HandRaiseQueue';
import FollowedByListeners from './partials/FollowedByListeners';
import SectionLabel from './partials/SectionLabel';
import { OtherCell } from './partials/ListenerCell';
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
// "Others" grid is denser (6 columns); MAIN LEVÉE / SUIVI rows use 5 columns
// (handled in their own partials, mirroring the SCÈNE stage grid).
const OTHERS_GRID_COLUMNS = 6;
const OTHER_AVATAR = 40;
// Cap how many "Others" avatars we render; the rest collapse into a trailing
// "+N" cell. The backend returns the full participant list, so without a cap a
// huge room would mount hundreds of cells (and the "+N" chip was dead UI).
const OTHERS_DISPLAY_CAP = 50;

// Pure layout constant (depends only on imported theme tokens) — hoisted so
// it isn't recomputed every render and can be shared by the inline styles.
// The trailing `spacing.sm` is the gap left between the control bar and the
// battle nav-bar (tab bar) below it — kept small so they sit close together.
const ACTION_BAR_BOTTOM_OFFSET = layout.tabBarHeight + layout.tabBarBottomOffset + spacing.sm;

export const RoomScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [isMuted, setIsMuted] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  // Optimistically reveal the mic the instant the viewer is promoted, before
  // the room detail refetch flips their derived role (#19). Reset on demotion.
  const [forceSpeaker, setForceSpeaker] = useState(false);
  // Seed `isMuted` exactly once per room entry from the server snapshot (#1/#3).
  const seededRoomRef = useRef<string | null>(null);

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
  // Kept in a ref so the socket effect's `endedHandler` can tell whether the
  // viewer is the host WITHOUT adding `viewerIsHost` to the effect deps (which
  // would re-subscribe every room refetch). The host already navigates via the
  // end-room mutation's onSettled, so they must NOT also run the "closed by the
  // host" alert + a second goBack (#4).
  const viewerIsHostRef = useRef(viewerIsHost);
  viewerIsHostRef.current = viewerIsHost;
  // The mic button only makes sense for users with publishing rights
  // (LiveKit "canPublish"). Listeners have canPublish=false and silently
  // produce nothing — showing a Mute button to them would be a dead control.
  // `forceSpeaker` reveals it immediately on promotion, before the refetch.
  const viewerCanSpeak =
    forceSpeaker ||
    Boolean(
      viewerRole &&
      (viewerRole === 'host' || viewerRole === 'moderator' || viewerRole === 'speaker'),
    );

  // ─── Seed & reconcile local mirror-state from server truth ──────────
  // Seed `isMuted` once per room entry from the server snapshot, and keep the
  // currentRoomStore (the source of truth the audio engine reads when it
  // restores mute after a token renewal / reconnect) in sync — otherwise a
  // muted user is silently hot-unmuted on (re)entry or reconnect (#1/#2/#3/#12).
  useEffect(() => {
    if (!room || !viewerId) return;
    if (seededRoomRef.current === room.id) return;
    seededRoomRef.current = room.id;
    const mutedOnServer = room.speakers.find(s => s.id === viewerId)?.audio === 'muted';
    setIsMuted(mutedOnServer);
    useCurrentRoomStore.getState().setMuted(mutedOnServer);
  }, [room, viewerId]);

  // Reconcile the raise-hand button with the server queue so it never sticks
  // raised after a remount or after a moderator promotes/lowers the hand
  // (#11/#15). Optimistic toggles flip it instantly; this snaps it back to the
  // truth whenever the (socket-invalidated) queue actually changes.
  const serverHandRaised = useMemo(
    () => handRaises.some(h => h.id === viewerId),
    [handRaises, viewerId],
  );
  useEffect(() => {
    setIsHandRaised(serverHandRaised);
  }, [serverHandRaised]);

  // Subscribe to room broadcasts (user-joined, hand_raised, role_changed,
  // mute-changed, kicked, ended). Without this, the screen is static and
  // never reflects what other participants do.
  useRoomSocket(room?.id ?? null);

  // Capture mic + start producing once we're in the room. The LiveKit
  // engine auto-activates if `@livekit/react-native` is installed; in Expo
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
        // Keep the audio-engine source of truth in sync so a later reconnect
        // restores the correct mute state (#2).
        useCurrentRoomStore.getState().setMuted(payload.isMuted);
      };
      const kickHandler = (payload: { userId?: string; roomId?: string }): void => {
        // `room:user_kicked` is room-channel-broadcast (carries userId, filter
        // to self); `room:you_were_kicked` is the personal-channel fallback
        // delivered straight to the evicted socket (no userId needed). Both
        // land here.
        if (payload.userId && payload.userId !== viewerId) return;
        if (payload.roomId && payload.roomId !== roomId) return;
        // Pop the screen first so the user lands somewhere safe even if
        // they dismiss the alert. The 30-min RoomBan installed by the
        // backend prevents an immediate re-join.
        navigation.goBack();
        Alert.alert(
          t('room.alert.removedTitle', 'You have been removed'),
          t(
            'room.alert.removedBody',
            'A moderator has expelled you from this room. You cannot rejoin for 30 minutes.',
          ),
        );
      };
      // The host closed the room (REST /rooms/:id/end or socket room:end).
      // A missing roomId means "this room"; otherwise it must match the one
      // we're viewing. Pop the screen and tell the user it's over.
      const endedHandler = (payload: { roomId?: string }): void => {
        if (payload.roomId && payload.roomId !== roomId) return;
        // The host who ended the room navigates via the end-room mutation's
        // onSettled — they must not also see "closed by the host" nor goBack a
        // second time (#4).
        if (viewerIsHostRef.current) return;
        navigation.goBack();
        Alert.alert(
          t('room.alert.endedTitle', 'Room ended'),
          t('room.alert.endedBody', 'This room has been closed by the host.'),
        );
      };
      const roleHandler = (payload: { userId: string; role: string; roomId?: string }): void => {
        if (payload.userId !== viewerId) return;
        if (payload.roomId && payload.roomId !== roomId) return;
        // Promotion to a publishing role — reveal the mic immediately (#19)
        // and celebrate so the user notices the new control.
        if (payload.role === 'SPEAKER' || payload.role === 'MODERATOR' || payload.role === 'HOST') {
          setForceSpeaker(true);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            t('room.alert.stageTitle', 'On stage 🎙️'),
            payload.role === 'HOST'
              ? t('room.alert.roleHost', 'You are now the host of the room.')
              : payload.role === 'MODERATOR'
                ? t('room.alert.roleMod', 'You are now a moderator.')
                : t(
                    'room.alert.roleSpeaker',
                    'You can speak — tap Mute to toggle your microphone.',
                  ),
          );
        } else if (payload.role === 'LISTENER') {
          // Demotion to the audience — hide the mic and clear stale local
          // publishing state so a later re-promotion doesn't inherit a wrong
          // mute/hand badge (#18).
          setForceSpeaker(false);
          setIsMuted(false);
          setIsHandRaised(false);
          useCurrentRoomStore.getState().setMuted(false);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Alert.alert(
            t('room.alert.audienceTitle', 'Moved to audience'),
            t('room.alert.audienceBody', 'You are now a listener in this room.'),
          );
        }
      };
      socket.on('room:mute-changed', muteHandler);
      socket.on('room:user_kicked', kickHandler);
      // Personal-channel eviction fallback — delivered straight to the kicked
      // socket so a missed room-channel broadcast can't strand them (#16).
      socket.on('room:you_were_kicked', kickHandler);
      socket.on('room:role_changed', roleHandler);
      socket.on('room:ended', endedHandler);
      cleanup = () => {
        socket.off('room:mute-changed', muteHandler);
        socket.off('room:user_kicked', kickHandler);
        socket.off('room:you_were_kicked', kickHandler);
        socket.off('room:role_changed', roleHandler);
        socket.off('room:ended', endedHandler);
      };
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [navigation, roomId, viewerId, t]);

  const handleToggleMute = useCallback(async () => {
    if (!room) return;
    const next = !isMuted;
    // Optimistic flip — the badge follows the press immediately. Backend
    // is the source of truth: if it rejects, we roll back. The LiveKit
    // mute is fire-and-forget and not awaited because it's local — its
    // failure shouldn't drag down the API success.
    setIsMuted(next);
    useCurrentRoomStore.getState().setMuted(next);
    void audio.setMuted(next);
    try {
      await setMute.mutateAsync({ roomId: room.id, isMuted: next });
    } catch {
      // Backend refused — undo the badge, the engine source-of-truth AND
      // LiveKit to keep them consistent.
      setIsMuted(!next);
      useCurrentRoomStore.getState().setMuted(!next);
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
      t('room.alert.confirmEndTitle', 'End Room'),
      t('room.alert.confirmEndBody', '"{{title}}" will be closed for all participants. Continue?', {
        title: room.title,
      }),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('room.closeRoom', 'End Room'),
          style: 'destructive',
          onPress: () => endRoom.mutate(room.id, { onSettled: () => navigation.goBack() }),
        },
      ],
    );
  }, [endRoom, navigation, room, t]);

  const handleReportRoom = useCallback(() => {
    if (!room) return;
    Alert.alert(
      t('room.alert.reportTitle', 'Report this room'),
      t('room.alert.reportReason', 'What is the reason?'),
      [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: t('profile.reasons.spam', 'Spam'),
          onPress: () => reportRoom.mutate({ roomId: room.id, reason: 'spam' }),
        },
        {
          text: t('profile.reasons.harassment', 'Harassment'),
          onPress: () => reportRoom.mutate({ roomId: room.id, reason: 'harassment' }),
        },
        {
          text: t('profile.reasons.other', 'Other'),
          onPress: () => reportRoom.mutate({ roomId: room.id, reason: 'other' }),
        },
      ],
    );
  }, [reportRoom, room, t]);

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
  // user; tapping one promotes them to SPEAKER (host/mod only). The viewer's
  // OWN hand is excluded — it's a silent dead tap and inflated the count (#15);
  // their own raised state is reflected by the action-bar button instead.
  const handRaisedUsers = useMemo<UserSummary[]>(
    () =>
      handRaises
        .filter(h => h.id !== viewerId)
        .map(h => ({
          id: h.id,
          username: h.username,
          displayName: h.displayName,
          avatarUrl: h.avatarUrl,
        })),
    [handRaises, viewerId],
  );

  // Virtualized "Others" grid helpers — hoisted above the early returns so
  // the hook call count stays stable across renders.
  const othersKeyExtractor = useCallback((item: UserSummary) => item.id, []);
  const renderOtherItem = useCallback(
    ({ item }: { item: UserSummary }) => (
      <Pressable
        onPress={() => handleListenerPress(item)}
        accessibilityRole="button"
        accessibilityLabel={t('room.profileA11y', 'Profile of {{name}}', {
          name: item.displayName ?? item.username,
        })}
        style={styles.othersCell}
      >
        <OtherCell listener={item} />
      </Pressable>
    ),
    [handleListenerPress, t],
  );

  // Partition listeners into "followed by you" vs "others" using the
  // backend-computed `followedByViewer` flag (carried on each listener by
  // roomService). The positional fallback below applies ONLY to legacy
  // payloads where the flag is entirely ABSENT — NOT when the flag is present
  // but nobody is followed. Keying the fallback off `followed.length === 0`
  // wrongly showed the first FOLLOWED_COUNT listeners under "followed by you"
  // for any viewer who follows nobody in the room; gate on flag presence so
  // that case correctly yields an empty "followed" section.
  const { followedListeners, otherListeners } = useMemo(() => {
    const listeners = (room?.listeners ?? []) as RoomListener[];
    const hasFlag = listeners.some(l => l.followedByViewer !== undefined);
    const followed = listeners.filter(l => l.followedByViewer);
    if (!hasFlag) {
      // Legacy payload with no flag at all → keep the historical positional
      // split so old room shapes don't regress.
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

  // Bound how many "Others" we mount; the remainder collapses into a trailing
  // "+N" cell. The backend returns the full list, so this is the ONLY source of
  // a real overflow count (the previous `listenersCount - listeners.length` was
  // structurally always 0 → dead "+N" chip) (#6/#23).
  const displayedOthers = useMemo(
    () => otherListeners.slice(0, OTHERS_DISPLAY_CAP),
    [otherListeners],
  );
  const othersOverflow = Math.max(0, otherListeners.length - OTHERS_DISPLAY_CAP);

  // Override the viewer's own stage cell with their optimistic local mute so
  // the mic-off icon flips instantly on tap instead of lagging the server
  // round-trip (#17). Everyone else keeps the server-truth audio state.
  const speakersForStage = useMemo<RoomParticipant[]>(() => {
    if (!room) return [];
    if (!viewerId) return room.speakers;
    return room.speakers.map(s =>
      s.id === viewerId
        ? {
            ...s,
            audio: (isMuted
              ? 'muted'
              : s.audio === 'muted'
                ? 'idle'
                : s.audio) as RoomParticipant['audio'],
          }
        : s,
    );
  }, [room, viewerId, isMuted]);

  // Live "is speaking" per speaker, keyed by speaker id. The score map
  // keys the local user under SPEAKING_SELF_KEY; everyone else is keyed by
  // their user id. Computed here so the score graph stays in the orchestrator
  // and StageGrid stays purely presentational.
  const speakingLiveByUser = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const s of speakersForStage) {
      const key = s.id === viewerId ? SPEAKING_SELF_KEY : s.id;
      const score = audio.scores.get(key) ?? 0;
      map.set(s.id, score >= SPEAKING_SCORE_THRESHOLD && s.audio !== 'muted');
    }
    return map;
  }, [speakersForStage, viewerId, audio.scores]);

  if (isLoading) return <Loader fullscreen accessibilityLabel={t('common.loading')} />;
  if (isError || !room) {
    return <EmptyState title={t('room.unavailable')} description={t('room.mayHaveEnded')} />;
  }

  return (
    <View className="flex-1 bg-background">
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <View className="flex-row items-center gap-sm">
          <MaterialIcons name="graphic-eq" size={HEADER_ICON_SIZE} color={colors.primary} />
          <Text className="text-lg font-display text-primary tracking-tighter">
            {t('common.appName', 'Chathouse')}
          </Text>
        </View>
        <View className="flex-row items-center gap-xs">
          <Pressable
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel={t('room.shareA11y', 'Share room link')}
            hitSlop={8}
            className="w-9 h-9 items-center justify-center rounded-pill bg-overlay-white-5"
          >
            <MaterialIcons name="ios-share" size={18} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => setChatOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('room.openChatA11y', 'Open chat')}
            hitSlop={8}
            className="w-9 h-9 items-center justify-center rounded-pill bg-overlay-white-5"
          >
            <MaterialIcons name="chat" size={18} color={colors.text} />
          </Pressable>
          {viewerCanModerate && (
            <Pressable
              onPress={() => setControlsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('room.controlsA11y', 'Room controls')}
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
              accessibilityLabel={t('room.reportA11y', 'Report room')}
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
              accessibilityLabel={t('room.closeRoom', 'End Room')}
              hitSlop={8}
              className="bg-danger/15 border border-danger/30 px-lg py-xs rounded-pill"
            >
              <Text className="text-sm font-body-bold text-danger">
                {t('room.closeRoom', 'End Room')}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        className="flex-1"
        data={displayedOthers}
        numColumns={OTHERS_GRID_COLUMNS}
        keyExtractor={othersKeyExtractor}
        renderItem={renderOtherItem}
        contentContainerStyle={{
          paddingHorizontal: spacing.xxl,
          paddingTop: insets.top + spacing.mega,
          paddingBottom: insets.bottom + ACTION_BAR_BOTTOM_OFFSET + spacing.mega,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Audio status banner — driven by the LiveKit engine state. We
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
                    ? t('room.audioConnecting', '🔊 Connecting audio…')
                    : audio.status === 'unsupported'
                      ? t(
                          'room.audioUnsupported',
                          '⚠️ Audio requires an EAS dev-client (@livekit/react-native is unavailable in Expo Go).',
                        )
                      : audio.status === 'error'
                        ? `❌ ${audio.error ?? t('room.audioError', 'Audio error')}`
                        : audio.status === 'reconnecting'
                          ? t('room.audioReconnecting', '🔄 Reconnecting audio…')
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
                  {room.category && (
                    <View className="bg-primary/10 px-sm py-xxs rounded-xs">
                      <Text className="text-[10px] font-body-bold text-primary uppercase tracking-wider">
                        {room.categoryEmoji} {room.category}
                      </Text>
                    </View>
                  )}
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
                  viewerCanModerate
                    ? t('room.editTitleA11y', 'Edit title: {{title}}', { title: room.title })
                    : room.title
                }
              >
                <Text className="text-display font-display text-white tracking-tight leading-tight">
                  {room.title}
                </Text>
              </Pressable>
              <View className="flex-row items-center gap-sm mt-xs">
                {room.isLive ? (
                  <RoomTimer startedAt={room.startedAt} />
                ) : (
                  <Text className="text-[10px] text-ink-dim">
                    {room.scheduledFor
                      ? formatScheduled(room.scheduledFor)
                      : t('room.upcoming', 'Upcoming')}
                  </Text>
                )}
                <Text className="text-[10px] text-ink-dim">
                  {t('room.participants', '{{speakers}} speakers · {{listeners}} listeners', {
                    speakers: room.speakersCount,
                    listeners: room.listenersCount,
                  })}
                </Text>
              </View>
            </View>

            <StageGrid
              speakers={speakersForStage}
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

            {/* Section label for the virtualized "Others" grid */}
            {(otherListeners.length > 0 || othersOverflow > 0) && (
              <View className="mb-md">
                <SectionLabel label={t('room.others')} />
              </View>
            )}
          </>
        }
        ListFooterComponent={
          othersOverflow > 0 ? (
            <View style={styles.overflowChipWrapper}>
              <View style={styles.overflowChip}>
                <Text className="text-[9px] font-body-bold text-primary">+{othersOverflow}</Text>
              </View>
            </View>
          ) : (
            <View className="mb-huge" />
          )
        }
        columnWrapperStyle={styles.othersColumnWrapper}
      />

      {/* Bottom stack — a single flex-column anchored just above the battle
          nav-bar (the tab bar). Children stack top→bottom: reactions on top,
          control bar below. Using ONE bottom-anchored column (instead of two
          separately-offset absolute layers + a magic +60) keeps the two bars
          cleanly stacked and evenly spaced at ANY window height, and they can
          never overlap each other. `box-none` lets taps fall through the empty
          float area to the room content behind. */}
      <View
        className="absolute left-0 right-0 items-center px-xxl"
        // No `insets.bottom` here: the battle nav-bar (tab bar) is positioned
        // with a FIXED `bottom: tabBarBottomOffset` (no safe-area added), so the
        // stack must use the same fixed reference to sit just above it. Adding
        // insets.bottom double-counted the safe area and left a big gap.
        style={{ bottom: ACTION_BAR_BOTTOM_OFFSET }}
        pointerEvents="box-none"
      >
        {/* Reactions (top of the stack) — `mb-md` is the gap to the control bar. */}
        <View className="mb-md items-center" pointerEvents="box-none">
          <ReactionsBar roomId={room.id} viewerId={viewerId} />
        </View>
        {/* Control bar (below reactions, above the battle nav-bar). */}
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
      <RoomChatSidebar
        visible={chatOpen}
        roomId={room.id}
        onClose={() => setChatOpen(false)}
        chatEnabled={room.chatEnabled}
        chatVisibility={room.chatVisibility}
        canModerate={viewerCanModerate}
      />
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
  othersColumnWrapper: {
    marginBottom: spacing.md,
  },
  othersCell: {
    flex: 1,
    maxWidth: `${100 / OTHERS_GRID_COLUMNS}%`,
    alignItems: 'center',
  },
  overflowChipWrapper: {
    width: `${100 / OTHERS_GRID_COLUMNS}%`,
    alignItems: 'center',
    marginBottom: spacing.xxl,
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
});
