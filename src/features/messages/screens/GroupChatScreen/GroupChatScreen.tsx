import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { ContentReportSheet } from '../../../../shared/components/ContentReportSheet';
import { colors, spacing } from '../../../../shared/constants/theme';
import { useApiErrorToast } from '../../../../shared/hooks/useApiErrorToast';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import { useAuthStore } from '../../../auth/store/authStore';
import type { ContentReportReason } from '../../../../shared/types/moderation';
import { formatTime } from '../../../../shared/utils/intl';
import {
  useGroup,
  useGroupMessages,
  useMarkGroupRead,
  useSendGroupMessage,
  useSendGroupVoice,
  useReportGroupMessage,
} from '../../hooks/useGroups';
import { useGroupSocket } from '../../hooks/useGroupSocket';
import { useVoiceMessage } from '../../hooks/useVoiceMessage';
import VoiceRecordingBar from '../../components/VoiceRecordingBar';
import VoiceMessageBubble from '../../components/VoiceMessageBubble';
import type { GroupMessage } from '../../services/groupService';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'GroupChat'>;
type Route = RouteProp<MessageStackParamList, 'GroupChat'>;

// Matches the backend limit (groups.schema sendGroupMessageSchema max 2000).
const MAX_MESSAGE_LEN = 2000;
const COUNTER_THRESHOLD = 1900;

export const GroupChatScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const conversationId = route.params.conversationId;
  const myId = useAuthStore(s => s.user?.id ?? null);

  // Subscribe to realtime group events for as long as THIS screen is mounted,
  // so the thread stays live regardless of the entry point — it must not depend
  // on MessagesScreen being in the stack. The socket is a singleton and the hook
  // dedupes handlers, so double-mounting alongside MessagesScreen is safe.
  useGroupSocket();

  const { data: group } = useGroup(conversationId);
  const {
    data: messages,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGroupMessages(conversationId);
  const send = useSendGroupMessage();
  const sendVoice = useSendGroupVoice();
  const markRead = useMarkGroupRead();
  const reportMessage = useReportGroupMessage();
  const toastError = useApiErrorToast();
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);

  // Track the keyboard so the recording bar drops its bottom inset when the
  // keyboard is up (mirrors ChatDetailScreen).
  const [keyboardVisible, setKeyboardVisible] = useState(false);
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

  // Voice notes: record → upload → send to the group.
  const voiceSend = useCallback(
    async (audioUrl: string, durationMs: number) => {
      await sendVoice.mutateAsync({ conversationId, audioUrl, durationMs });
    },
    [sendVoice, conversationId],
  );
  const voice = useVoiceMessage(voiceSend);
  const handleMic = useCallback(() => {
    void voice.startRecording();
  }, [voice]);
  const handleVoiceSend = useCallback(() => {
    void voice.sendRecording();
  }, [voice]);

  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<GroupMessage>>(null);
  const sendInFlightRef = useRef(false);

  // Mark the thread read when there's something unread — on open and whenever
  // new messages land. Guarded so we don't fire a redundant PATCH every render.
  const unread = group?.unreadCount ?? 0;
  useEffect(() => {
    if (conversationId && unread > 0) markRead.mutate(conversationId);
    // markRead is stable from react-query; intentionally exclude it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, unread, messages?.length]);

  const title = useMemo(() => {
    if (group?.title) return group.title;
    const others = (group?.members ?? []).filter(m => m.id !== myId);
    if (others.length === 0) return t('messages.group', 'Group');
    return others.map(m => m.displayName || m.username).join(', ');
  }, [group, myId, t]);

  const memberCountLabel = useMemo(() => {
    const n = group?.members.length ?? 0;
    return t('messages.memberCount', { count: n, defaultValue: `${n} members` });
  }, [group?.members.length, t]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of group?.members ?? []) map.set(m.id, m.displayName || m.username);
    return map;
  }, [group?.members]);

  // Reversed for the `inverted` FlatList — newest at index 0 (visual bottom),
  // so new messages pin to the bottom without an onContentSizeChange→scrollToEnd hack.
  const data = useMemo(() => [...(messages ?? [])].reverse(), [messages]);

  const handleSend = useCallback(async () => {
    if (sendInFlightRef.current) return;
    const text = draft.trim();
    if (text.length === 0) return;
    sendInFlightRef.current = true;
    setDraft('');
    try {
      await send.mutateAsync({ conversationId, text });
    } catch (err) {
      // Preserve anything typed while the failed request was in flight; only
      // restore the sent text when the composer is still empty.
      setDraft(current => (current.trim().length === 0 ? text : current));
      toastError(err);
    } finally {
      sendInFlightRef.current = false;
    }
  }, [conversationId, draft, send, toastError]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleOpenInfo = useCallback(
    () => navigation.navigate('GroupInfo', { conversationId }),
    [conversationId, navigation],
  );

  const handleReportReason = useCallback(
    (reason: ContentReportReason) => {
      if (!reportMessageId || reportMessage.isPending) return;
      reportMessage.mutate(
        { conversationId, messageId: reportMessageId, reason },
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
          onError: toastError,
        },
      );
    },
    [conversationId, reportMessage, reportMessageId, t, toastError],
  );

  const renderItem = useCallback(
    ({ item }: { item: GroupMessage }) => {
      const isMine = item.senderId === myId;
      return (
        <Pressable
          testID={`group-message-${item.id}`}
          className={isMine ? 'items-end px-xxl py-xxs' : 'items-start px-xxl py-xxs'}
          onLongPress={!isMine ? () => setReportMessageId(item.id) : undefined}
          delayLongPress={350}
          accessible={!isMine}
          accessibilityRole={!isMine ? 'button' : undefined}
          accessibilityActions={
            !isMine
              ? [
                  {
                    name: 'report',
                    label: t('moderation.reportMessageA11y', 'Report this message'),
                  },
                ]
              : undefined
          }
          onAccessibilityAction={
            !isMine
              ? event => {
                  if (event.nativeEvent.actionName === 'report') setReportMessageId(item.id);
                }
              : undefined
          }
          accessibilityHint={
            !isMine
              ? t('moderation.longPressToReport', 'Long press to report this message')
              : undefined
          }
        >
          {!isMine && (
            <Text className="text-xxs font-body-medium text-ink-muted ml-sm mb-xxs">
              {nameById.get(item.senderId) ?? item.sender?.displayName ?? '—'}
            </Text>
          )}
          <View
            className={
              isMine
                ? 'bg-primary rounded-2xl rounded-tr-sm px-md py-sm max-w-[80%]'
                : 'bg-overlay-white-10 rounded-2xl rounded-tl-sm px-md py-sm max-w-[80%]'
            }
          >
            {item.kind === 'voice' && item.audioUrl ? (
              <VoiceMessageBubble
                audioUrl={item.audioUrl}
                durationMs={item.durationMs}
                isMine={isMine}
                foregroundColor={isMine ? colors.onPrimary : undefined}
              />
            ) : (
              <Text className={isMine ? 'text-sm text-primary-on-container' : 'text-sm text-ink'}>
                {item.content}
              </Text>
            )}
          </View>
          {/* Timestamp under each bubble, matching the 1:1 Bubble pattern. */}
          <Text
            className={
              isMine
                ? 'text-[10px] text-ink-muted mr-xs mt-xxs'
                : 'text-[10px] text-ink-muted ml-xs mt-xxs'
            }
          >
            {formatTime(item.createdAt)}
          </Text>
        </Pressable>
      );
    },
    [myId, nameById, t],
  );

  // Inverted list: "end" = the visual TOP = the oldest loaded message. Reaching
  // it pulls the next (older) page via the `before` cursor.
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const listFooter = isFetchingNextPage ? (
    <View className="py-md items-center">
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center gap-md px-xxl py-md border-b border-overlay-white-5">
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'Back')}
          hitSlop={12}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={handleOpenInfo}
          accessibilityRole="button"
          accessibilityLabel={t('messages.groupInfo', 'Group info')}
          className="flex-1 active:opacity-70"
        >
          <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-xxs font-body text-ink-muted">{memberCountLabel}</Text>
        </Pressable>
        <Pressable
          onPress={handleOpenInfo}
          accessibilityRole="button"
          accessibilityLabel={t('messages.groupInfo', 'Group info')}
          hitSlop={8}
        >
          <MaterialIcons name="info-outline" size={22} color={colors.textMuted} />
        </Pressable>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading')} />
      ) : isError ? (
        <EmptyState
          title={t('chat.loadErrorTitle', 'Impossible de charger les messages')}
          description={t('chat.loadErrorHint', 'Vérifiez votre connexion puis réessayez.')}
          actionLabel={t('common.retry', 'Retry')}
          onAction={() => void refetch()}
        />
      ) : data.length === 0 ? (
        <EmptyState
          title={t('chat.emptyTitle', 'Aucun message pour le moment')}
          description={t('chat.emptyHint', 'Envoyez un message pour démarrer la conversation.')}
        />
      ) : (
        <FlatList
          ref={listRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          inverted
          contentContainerStyle={{ paddingVertical: spacing.md }}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={listFooter}
          testID="group-thread-list"
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
        <View
          className="flex-row items-end gap-sm px-xxl py-sm border-t border-overlay-white-5"
          style={{ paddingBottom: insets.bottom + spacing.sm }}
        >
          <View className="flex-1">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('messages.messagePlaceholder', 'Message')}
              accessibilityLabel={t('messages.messagePlaceholder', 'Message')}
              placeholderTextColor={colors.textMuted}
              maxLength={MAX_MESSAGE_LEN}
              multiline
              className="min-h-[44px] max-h-28 bg-overlay-white-5 rounded-2xl border border-outline px-md py-sm text-ink"
            />
            {draft.length >= COUNTER_THRESHOLD ? (
              <Text className="text-[10px] text-ink-muted self-end mt-xxs mr-sm">
                {`${draft.length}/${MAX_MESSAGE_LEN}`}
              </Text>
            ) : null}
          </View>
          {draft.trim().length > 0 ? (
            <Pressable
              onPress={handleSend}
              disabled={send.isPending}
              accessibilityRole="button"
              accessibilityLabel={t('common.send', 'Send')}
              className="w-11 h-11 rounded-pill bg-primary items-center justify-center"
            >
              <MaterialIcons name="send" size={20} color={colors.onPrimary} />
            </Pressable>
          ) : (
            <Pressable
              onPress={handleMic}
              accessibilityRole="button"
              accessibilityLabel={t('voice.recordA11y')}
              hitSlop={12}
              className="w-11 h-11 rounded-pill bg-overlay-white-10 items-center justify-center"
            >
              <MaterialIcons name="mic" size={20} color={colors.text} />
            </Pressable>
          )}
        </View>
      )}
      <ContentReportSheet
        visible={reportMessageId !== null}
        submitting={reportMessage.isPending}
        onClose={() => setReportMessageId(null)}
        onSelect={handleReportReason}
      />
    </KeyboardAvoidingView>
  );
};
