import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { ContentReportSheet } from '../../../../shared/components/ContentReportSheet';
import { useApiErrorToast } from '../../../../shared/hooks/useApiErrorToast';
import { toAppError } from '../../../../shared/services/api/errorHandler';
import { formatWeekdayDate } from '../../../../shared/utils/intl';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import type { Message, UserSummary } from '../../../../shared/types/domain';
import type { ContentReportReason } from '../../../../shared/types/moderation';
import { useAuthStore } from '../../../auth/store/authStore';
import {
  useConversation,
  useConversationMessages,
  useSendMessage,
  useSendVoiceMessage,
  useMarkConversationRead,
  useDeleteMessage,
  useReportMessage,
} from '../../hooks/useMessages';
import { useChatSocket } from '../../hooks/useChatSocket';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useVoiceMessage } from '../../hooks/useVoiceMessage';
import { usePeerPresence } from '../../../extensions/hooks/usePeerPresence';
import { useCreateRoom } from '../../../rooms/hooks/useRooms';
import { ROOM_TITLE_MAX } from '../../../rooms/constants';
import { useBlock, useReport } from '../../../social/hooks/useSocial';
import type { ReportReason } from '../../../social/services/socialService';
import { ProfileReportSheet } from '../../../social/components/ProfileReportSheet';
import VoiceRecordingBar from '../../components/VoiceRecordingBar';
import Bubble from './partials/Bubble';
import DateSeparator from './partials/DateSeparator';
import ChatHeader from './partials/ChatHeader';
import ChatInputBar from './partials/ChatInputBar';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'ChatDetail'>;
type Route = RouteProp<MessageStackParamList, 'ChatDetail'>;

const sameDay = (a: string, b: string): boolean => {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

// Date label is locale-aware: i18n translates "Today"/"Yesterday", while the
// shared formatter handles older dates consistently even without full ICU.
const formatDateLabel = (iso: string, todayLabel: string, yesterdayLabel: string): string => {
  const today = new Date();
  if (sameDay(iso, today.toISOString())) return todayLabel;
  const yesterday = new Date(today.getTime() - 86400000);
  if (sameDay(iso, yesterday.toISOString())) return yesterdayLabel;
  return formatWeekdayDate(iso);
};

interface ChatListItem {
  kind: 'message' | 'date';
  id: string;
  date?: string;
  message?: Message;
  showAvatar?: boolean;
}

const buildChatItems = (messages: readonly Message[]): ChatListItem[] => {
  const items: ChatListItem[] = [];
  let lastDate: string | null = null;
  messages.forEach((m, i) => {
    if (!lastDate || !sameDay(lastDate, m.sentAt)) {
      items.push({ kind: 'date', id: `date-${m.id}`, date: m.sentAt });
      lastDate = m.sentAt;
    }
    const next = messages[i + 1];
    const showAvatar = !next || next.isMine !== m.isMine || !sameDay(next.sentAt, m.sentAt);
    items.push({ kind: 'message', id: m.id, message: m, showAvatar });
  });
  return items;
};

export const ChatDetailScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatListItem>>(null);
  const [draft, setDraft] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const reportApiError = useApiErrorToast();
  const { t } = useTranslation();
  // Identify "me" exclusively from the authenticated session. A missing user
  // during auth hydration must never substitute a fictitious production id.
  const myId = useAuthStore(s => s.user?.id ?? '');

  // Subscribe to realtime chat events for as long as THIS screen is mounted,
  // so the thread stays live regardless of the entry point (deep link, Room,
  // Maps…) — it must not depend on MessagesScreen being in the stack. The
  // socket is a singleton and the hook dedupes handlers, so double-mounting
  // alongside MessagesScreen is safe.
  useChatSocket();

  // Inverted list: the latest message lives at offset 0 (the visual bottom),
  // so "scroll to bottom" is a scroll-to-offset-0, not scrollToEnd.
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }, []);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The conversation id IS the peer's user id (see messageService), so it
  // doubles as the `receiverId` for the typing relay.
  const peerId = route.params.conversationId;
  const { data: peerPresence } = usePeerPresence(peerId);
  const { data: conversation } = useConversation(peerId);
  const {
    data: messages,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useConversationMessages(peerId);
  const sendMessage = useSendMessage();
  const sendVoice = useSendVoiceMessage();
  const markRead = useMarkConversationRead();
  const deleteMessage = useDeleteMessage();
  const reportMessage = useReportMessage();
  const createRoom = useCreateRoom();
  const blockUser = useBlock();
  const reportUser = useReport();
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
  const [reportUserVisible, setReportUserVisible] = useState(false);
  const sendInFlightRef = useRef(false);
  const { isPeerTyping, notifyTyping } = useTypingIndicator(peerId);
  // Keep an immediate lock in addition to the mutation state: two taps can
  // arrive before React has rendered `isPending=true`.
  const callInFlightRef = useRef(false);

  const other: UserSummary | undefined =
    conversation?.participants.find(p => p.id !== myId) ?? conversation?.participants[0];
  const otherAvatar = other?.avatarUrl ?? null;

  // Voice notes: record → upload → send, then pin the thread to the bottom.
  const voiceSend = useCallback(
    async (audioUrl: string, durationMs: number) => {
      await sendVoice.mutateAsync({ conversationId: peerId, audioUrl, durationMs });
      scrollToBottom();
    },
    [sendVoice, peerId, scrollToBottom],
  );
  const voice = useVoiceMessage(voiceSend);
  const handleMic = useCallback(() => {
    void voice.startRecording();
  }, [voice]);
  const handleVoiceSend = useCallback(() => {
    void voice.sendRecording();
  }, [voice]);

  // Wrap the draft setter so every keystroke also pings the peer (the hook
  // throttles the actual socket emit).
  const handleDraftChange = useCallback(
    (text: string) => {
      setDraft(text);
      notifyTyping();
    },
    [notifyTyping],
  );

  // Opening a conversation with unread messages marks them read server-side so
  // the row pip and the Messages tab badge clear. `markedRef` avoids re-firing
  // on every render while the conversations cache re-hydrates to 0.
  const markedRef = useRef(false);
  useEffect(() => {
    markedRef.current = false;
  }, [route.params.conversationId]);
  useEffect(() => {
    if ((conversation?.unreadCount ?? 0) > 0 && !markedRef.current && !markRead.isPending) {
      markedRef.current = true;
      markRead.mutate(route.params.conversationId);
    }
  }, [conversation?.unreadCount, route.params.conversationId, markRead]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleSend = useCallback(async () => {
    if (!draft.trim() || sendInFlightRef.current || sendMessage.isPending) return;
    const submittedDraft = draft;
    sendInFlightRef.current = true;
    try {
      await sendMessage.mutateAsync({
        conversationId: route.params.conversationId,
        text: submittedDraft,
      });
      // Preserve text entered while the previous message was in flight.
      setDraft(current => (current === submittedDraft ? '' : current));
      scrollToBottom();
    } catch (err) {
      // Privacy/follows can change after the compose eligibility snapshot.
      // Keep this authoritative send-time fallback and preserve the draft.
      const e = toAppError(err);
      if (e.kind === 'forbidden') {
        Alert.alert(
          t('chat.cannotMessageTitle', 'Message impossible'),
          t(
            'chat.cannotMessageBody',
            'Cette personne ne peut pas recevoir de message privé de votre part pour le moment.',
          ),
        );
        return;
      }
      reportApiError(err);
    } finally {
      sendInFlightRef.current = false;
    }
  }, [draft, reportApiError, route.params.conversationId, scrollToBottom, sendMessage, t]);

  const handleCall = useCallback(async () => {
    if (callInFlightRef.current || createRoom.isPending) return;

    callInFlightRef.current = true;
    const peerName = other?.displayName?.trim() || other?.username?.trim();
    const localizedTitle = peerName
      ? t('chat.privateCallTitle', { name: peerName })
      : t('chat.privateCallFallbackTitle');
    // Profile names can be longer than room titles. Apply the same client-side
    // bound as CreateRoomScreen before sending the localized title.
    const title = localizedTitle.slice(0, ROOM_TITLE_MAX).trimEnd();

    try {
      const created = await createRoom.mutateAsync({
        title,
        visibility: 'closed',
        topics: [],
        coHostIds: [peerId],
        chatEnabled: false,
        recordingEnabled: false,
        maxSpeakers: 2,
      });

      // ChatDetail belongs to MessagesStack. Route through the root and the
      // Rooms tab so the newly-created LiveKit room opens in its owning stack.
      (navigation as unknown as { navigate: (screen: string, params: object) => void }).navigate(
        'Main',
        {
          screen: 'RoomsTab',
          params: { screen: 'Room', params: { roomId: created.id } },
        },
      );
    } catch (err) {
      reportApiError(err);
    } finally {
      callInFlightRef.current = false;
    }
  }, [createRoom, navigation, other?.displayName, other?.username, peerId, reportApiError, t]);
  const submitUserReport = useCallback(
    (reason: ReportReason) => {
      if (reportUser.isPending) return;
      reportUser.mutate(
        { userId: peerId, input: { reason } },
        {
          onSuccess: () => {
            setReportUserVisible(false);
            Alert.alert(t('profile.reportThanks'));
          },
          onError: reportApiError,
        },
      );
    },
    [peerId, reportApiError, reportUser, t],
  );

  const handleReportUser = useCallback(() => setReportUserVisible(true), []);

  const handleBlockUser = useCallback(() => {
    const peerHandle = other?.username?.trim() || other?.displayName?.trim() || peerId;
    Alert.alert(
      t('profile.blockConfirmTitle', { handle: peerHandle }),
      t('profile.blockConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.blockConfirm'),
          style: 'destructive',
          onPress: () => {
            if (blockUser.isPending) return;
            blockUser.mutate(peerId, {
              onSuccess: () => navigation.goBack(),
              onError: reportApiError,
            });
          },
        },
      ],
      { cancelable: true },
    );
  }, [blockUser, navigation, other?.displayName, other?.username, peerId, reportApiError, t]);

  const handleMore = useCallback(() => {
    const peerHandle = other?.username?.trim()
      ? `@${other.username.trim()}`
      : other?.displayName?.trim();
    Alert.alert(
      t('chat.moreLabel', 'Options de la conversation'),
      peerHandle,
      [
        { text: t('profile.report'), onPress: handleReportUser },
        { text: t('profile.block'), style: 'destructive', onPress: handleBlockUser },
        { text: t('common.cancel'), style: 'cancel' },
      ],
      { cancelable: true },
    );
  }, [handleBlockUser, handleReportUser, other?.displayName, other?.username, t]);
  // Chronological items, then reversed for the `inverted` FlatList: index 0 is
  // the newest (rendered at the visual bottom), which keeps the thread pinned
  // to the latest message with no onContentSizeChange→scrollToEnd hack.
  const items = useMemo(() => buildChatItems(messages ?? []).reverse(), [messages]);

  const todayLabel = t('chat.dateToday');
  const yesterdayLabel = t('chat.dateYesterday');

  // Long press keeps sender-only deletion for your messages and exposes the
  // required per-item report action for content received from the peer.
  const handleMessageLongPress = useCallback(
    (message: Message) => {
      if (!message.isMine) {
        setReportMessageId(message.id);
        return;
      }
      Alert.alert(
        t('chat.deleteTitle', 'Supprimer le message'),
        t('chat.deleteBody', 'Ce message sera supprimé définitivement.'),
        [
          { text: t('common.cancel', 'Annuler'), style: 'cancel' },
          {
            text: t('common.delete', 'Supprimer'),
            style: 'destructive',
            onPress: () =>
              deleteMessage.mutate(
                { messageId: message.id, conversationId: peerId },
                { onError: reportApiError },
              ),
          },
        ],
      );
    },
    [deleteMessage, peerId, reportApiError, t],
  );

  const handleReportReason = useCallback(
    (reason: ContentReportReason) => {
      if (!reportMessageId || reportMessage.isPending) return;
      reportMessage.mutate(
        { messageId: reportMessageId, reason },
        {
          onSuccess: result => {
            setReportMessageId(null);
            Alert.alert(
              t('moderation.reportSentTitle', 'Report sent'),
              result.alreadyReported
                ? t('moderation.reportAlreadySent', 'You already reported this message.')
                : t('moderation.reportSentBody', 'The moderation team will review this message.'),
            );
          },
          onError: reportApiError,
        },
      );
    },
    [reportApiError, reportMessage, reportMessageId, t],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.kind === 'date' && item.date) {
        return <DateSeparator label={formatDateLabel(item.date, todayLabel, yesterdayLabel)} />;
      }
      if (item.message) {
        return (
          <Bubble
            message={item.message}
            otherAvatar={otherAvatar}
            showAvatar={item.showAvatar ?? true}
            onLongPress={handleMessageLongPress}
          />
        );
      }
      return null;
    },
    [otherAvatar, todayLabel, yesterdayLabel, handleMessageLongPress],
  );

  const keyExtractor = useCallback((item: ChatListItem) => item.id, []);

  // Inverted list: "end" = the visual TOP = the oldest loaded message. Reaching
  // it pulls the next (older) page via the `before` cursor.
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Rendered at the end of the data = the visual top, right where the older
  // page will appear.
  const listFooter = isFetchingNextPage ? (
    <View style={styles.pageLoader}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  ) : null;

  // The server reveals presence only to an allowed relationship. Hidden,
  // blocked and non-reciprocal private peers all resolve to a neutral offline
  // payload, so the UI never leaks relationship-sensitive activity.
  const isOnline = peerPresence?.visible === true && peerPresence.isOnline;
  const canSend = draft.trim().length > 0 && !sendMessage.isPending;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
      style={styles.kav}
    >
      <ChatHeader
        topInset={insets.top}
        otherAvatar={otherAvatar}
        isOnline={isOnline}
        isTyping={isPeerTyping}
        displayName={other?.displayName}
        username={other?.username}
        onBack={handleBack}
        onCall={handleCall}
        callPending={createRoom.isPending}
        onMore={handleMore}
      />

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading')} />
      ) : isError ? (
        <EmptyState
          title={t('chat.loadErrorTitle', 'Impossible de charger les messages')}
          description={t('chat.loadErrorHint', 'Vérifiez votre connexion puis réessayez.')}
          actionLabel={t('common.retry', 'Retry')}
          onAction={() => void refetch()}
        />
      ) : items.length === 0 ? (
        // Brand-new thread (e.g. opened from a profile): invite the first
        // message instead of a blank scroll area. Rendered OUTSIDE the inverted
        // FlatList — an inverted ListEmptyComponent renders upside down.
        <EmptyState
          title={t('chat.emptyTitle', 'Aucun message pour le moment')}
          description={t('chat.emptyHint', 'Envoyez un message pour démarrer la conversation.')}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          inverted
          style={styles.flex1}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={listFooter}
          testID="chat-thread-list"
        />
      )}

      {voice.isActive ? (
        <VoiceRecordingBar
          elapsedMs={voice.elapsedMs}
          isUploading={voice.isUploading}
          onCancel={voice.cancelRecording}
          onSend={handleVoiceSend}
          bottomInset={insets.bottom}
          keyboardVisible={keyboardVisible}
        />
      ) : (
        <ChatInputBar
          value={draft}
          onChangeText={handleDraftChange}
          onSend={handleSend}
          canSend={canSend}
          bottomInset={insets.bottom}
          keyboardVisible={keyboardVisible}
          onMic={handleMic}
          onInputFocus={scrollToBottom}
        />
      )}
      <ContentReportSheet
        visible={reportMessageId !== null}
        submitting={reportMessage.isPending}
        onClose={() => setReportMessageId(null)}
        onSelect={handleReportReason}
      />
      <ProfileReportSheet
        visible={reportUserVisible}
        targetLabel={other?.username?.trim() || other?.displayName?.trim() || peerId}
        submitting={reportUser.isPending}
        onClose={() => setReportUserVisible(false)}
        onSelect={submitUserReport}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  kav: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  list: {
    paddingHorizontal: spacing.xxl,
    // Inverted list: paddingTop maps to the visual bottom (near the input bar)
    // and paddingBottom to the visual top (under the header).
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  pageLoader: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
