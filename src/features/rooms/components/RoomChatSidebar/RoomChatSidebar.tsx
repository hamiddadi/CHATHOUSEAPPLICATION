import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatmodApi } from '../../../extensions';
import { Avatar } from '../../../../shared/components/Avatar';
import { ContentReportSheet } from '../../../../shared/components/ContentReportSheet';
import { colors, layout, spacing, withAlpha } from '../../../../shared/constants/theme';
import { getSocket } from '../../../../shared/services/realtime/socketClient';
import type { ContentReportReason } from '../../../../shared/types/moderation';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { useAuthStore } from '../../../auth/store/authStore';
import {
  roomKeys,
  useReportRoomMessage,
  useRoomMessages,
  useSendRoomMessage,
} from '../../hooks/useRooms';

// Defer the scroll-to-end so the FlatList finishes layout before scrolling.
const SCROLL_DEFER_MS = 50;
// Per-message character cap — mirrors the backend's room-message limit.
const MAX_MESSAGE_LENGTH = 500;

interface RoomChatSidebarProps {
  visible: boolean;
  roomId: string;
  onClose: () => void;
  // Posting gate (defaults keep the composer enabled for backward compat). The
  // backend enforces these too; surfacing them here avoids a misleading composer
  // that only errors on send.
  chatEnabled?: boolean;
  chatVisibility?: 'ALL' | 'MODS_ONLY';
  canModerate?: boolean;
}

interface ChatUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

interface ChatMessage {
  id: string;
  content: string;
  createdAt: string;
  user: ChatUser;
  replyTo: { id: string; content: string; user: ChatUser } | null;
}

interface IncomingChatPayload {
  roomId: string;
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  replyTo?: {
    id: string;
    content: string;
    user: {
      id: string;
      username: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    };
  } | null;
}

const normalizeUser = (u: IncomingChatPayload['user']): ChatUser => ({
  id: u.id,
  username: u.username ?? '',
  displayName: u.displayName ?? u.username ?? '',
  avatarUrl: u.avatarUrl,
});

export const RoomChatSidebar: React.FC<RoomChatSidebarProps> = memo(
  ({
    visible,
    roomId,
    onClose,
    chatEnabled = true,
    chatVisibility = 'ALL',
    canModerate = false,
  }) => {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    // Can the viewer post? Chat must be on, and either open to all or the viewer
    // is a host/moderator. When they can't, we replace the composer with a note.
    const canPost = chatEnabled && (chatVisibility !== 'MODS_ONLY' || canModerate);
    const cantPostNotice = !chatEnabled ? t('roomChat.chatDisabled') : t('roomChat.moderatorsOnly');
    const { data: messages = [] } = useRoomMessages(visible ? roomId : null);
    const sendMessage = useSendRoomMessage();
    const reportMessage = useReportRoomMessage();
    const qc = useQueryClient();
    const myId = useAuthStore(s => s.user?.id ?? null);
    const [draft, setDraft] = useState('');
    const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
    const [reportMessageId, setReportMessageId] = useState<string | null>(null);
    const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
    const sendInFlightRef = useRef(false);
    const listRef = useRef<FlatList<ChatMessage>>(null);
    const hasSendableDraft = draft.trim().length > 0;
    const sendDisabled = !hasSendableDraft || sendMessage.isPending;

    // Subscribe to live `room:chat_message` so new entries land instantly
    // without polling. The hook only attaches while the sidebar is mounted
    // — closing detaches via the cleanup branch.
    useEffect(() => {
      if (!visible) return;
      // Race-safety: the sidebar can close (visible → false) before the
      // async getSocket() resolves. Without this flag, the listener would
      // be registered AFTER the cleanup ran, leaking the handler forever.
      let cancelled = false;
      let cleanup: (() => void) | undefined;
      void (async () => {
        const socket = await getSocket();
        if (cancelled || !socket) return;
        const handler = (payload: IncomingChatPayload): void => {
          if (payload.roomId !== roomId) return;
          // Append to the cached list instead of refetching everything.
          qc.setQueryData<ChatMessage[]>([...roomKeys.all, 'messages', roomId] as const, prev => {
            const next: ChatMessage = {
              id: payload.id,
              content: payload.content,
              createdAt: payload.createdAt,
              user: normalizeUser(payload.user),
              replyTo: payload.replyTo
                ? {
                    id: payload.replyTo.id,
                    content: payload.replyTo.content,
                    user: normalizeUser(payload.replyTo.user),
                  }
                : null,
            };
            if (!prev) return [next];
            if (prev.some(m => m.id === next.id)) return prev;
            return [...prev, next];
          });
        };
        socket.on('room:chat_message', handler);
        cleanup = () => socket.off('room:chat_message', handler);
      })();
      return () => {
        cancelled = true;
        cleanup?.();
      };
    }, [qc, roomId, visible]);

    useEffect(() => {
      if (visible && messages.length > 0) {
        // Defer scroll so the FlatList finishes layout first.
        const id = setTimeout(
          () => listRef.current?.scrollToEnd({ animated: true }),
          SCROLL_DEFER_MS,
        );
        return () => clearTimeout(id);
      }
    }, [messages.length, visible]);

    const handleSend = useCallback(() => {
      const content = draft.trim();
      // `isPending` reaches the rendered tree asynchronously. The ref closes the
      // same-tick double-press window before React Query can publish that state.
      if (content.length === 0 || sendInFlightRef.current || sendMessage.isPending) return;
      sendInFlightRef.current = true;
      sendMessage.mutate(
        { roomId, content, replyToId: replyTo?.id },
        {
          onSuccess: () => {
            setDraft('');
            setReplyTo(null);
          },
          onError: e => Alert.alert(t('common.error'), errorMessage(e, t('roomChat.sendFailed'))),
          onSettled: () => {
            sendInFlightRef.current = false;
          },
        },
      );
    }, [draft, roomId, replyTo, sendMessage, t]);

    const handleStartReply = useCallback((msg: ChatMessage) => setReplyTo(msg), []);
    const handleCancelReply = useCallback(() => setReplyTo(null), []);

    const handleReportReason = useCallback(
      (reason: ContentReportReason) => {
        if (!reportMessageId || reportMessage.isPending) return;
        reportMessage.mutate(
          { roomId, messageId: reportMessageId, reason },
          {
            onSuccess: result => {
              setReportMessageId(null);
              Alert.alert(
                t('moderation.reportSentTitle'),
                result.alreadyReported
                  ? t('moderation.reportAlreadySent')
                  : t('moderation.reportSentBody'),
              );
            },
            onError: e =>
              Alert.alert(t('common.error'), errorMessage(e, t('moderation.reportFailed'))),
          },
        );
      },
      [reportMessage, reportMessageId, roomId, t],
    );

    // Host/mod-only: drop a message from the cache after the API confirms.
    // Same query key the socket handler writes to, so the list stays in sync.
    const handleDeleteMessage = useCallback(
      (msg: ChatMessage) => {
        Alert.alert(t('roomChat.deleteTitle'), t('roomChat.deleteBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => {
              if (deletingMessageId !== null) return;
              const key = [...roomKeys.all, 'messages', roomId] as const;
              const previous = qc.getQueryData<ChatMessage[]>(key);
              setDeletingMessageId(msg.id);
              // Optimistic removal — re-add the cached list on failure.
              qc.setQueryData<ChatMessage[]>(key, prev =>
                prev ? prev.filter(m => m.id !== msg.id) : prev,
              );
              void chatmodApi
                .deleteMessage(msg.id)
                .catch(e => {
                  if (previous) qc.setQueryData<ChatMessage[]>(key, previous);
                  Alert.alert(t('common.error'), errorMessage(e, t('roomChat.deleteFailed')));
                })
                .finally(() => setDeletingMessageId(null));
            },
          },
        ]);
      },
      [deletingMessageId, qc, roomId, t],
    );

    const renderItem = useCallback(
      ({ item }: { item: ChatMessage }) => (
        <View style={styles.row}>
          <Avatar
            uri={item.user.avatarUrl ?? undefined}
            name={item.user.displayName}
            sizeValue={28}
          />
          <View style={styles.bubble}>
            <View style={styles.bubbleHeader}>
              <Text style={styles.author}>{item.user.displayName || item.user.username}</Text>
              <View style={styles.messageActions}>
                {item.user.id !== myId ? (
                  <Pressable
                    onPress={() => setReportMessageId(item.id)}
                    hitSlop={8}
                    disabled={reportMessage.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={t('moderation.reportMessageA11y')}
                    accessibilityState={{
                      busy: reportMessage.isPending,
                      disabled: reportMessage.isPending,
                    }}
                    style={styles.messageAction}
                  >
                    <MaterialIcons name="flag" size={16} color={colors.danger} />
                  </Pressable>
                ) : null}
                {canModerate ? (
                  <Pressable
                    onPress={() => handleDeleteMessage(item)}
                    hitSlop={8}
                    disabled={deletingMessageId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={t('roomChat.deleteMessageA11y')}
                    accessibilityState={{
                      busy: deletingMessageId === item.id,
                      disabled: deletingMessageId !== null,
                    }}
                    style={styles.messageAction}
                  >
                    <MaterialIcons name="delete-outline" size={16} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            </View>
            <Pressable
              onLongPress={() => handleStartReply(item)}
              accessibilityRole="button"
              accessibilityLabel={t('roomChat.messageA11y', {
                name: item.user.displayName || item.user.username,
              })}
              accessibilityHint={t('roomChat.replyMessageHint')}
              accessibilityActions={[{ name: 'reply', label: t('roomChat.replyMessageHint') }]}
              onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === 'reply') handleStartReply(item);
              }}
            >
              {item.replyTo ? (
                <View style={styles.replyQuote}>
                  <Text style={styles.replyAuthor} numberOfLines={1}>
                    ↳ @{item.replyTo.user.username || item.replyTo.user.displayName}
                  </Text>
                  <Text style={styles.replySnippet} numberOfLines={2}>
                    {item.replyTo.content}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.content}>{item.content}</Text>
            </Pressable>
          </View>
        </View>
      ),
      [
        canModerate,
        deletingMessageId,
        handleDeleteMessage,
        handleStartReply,
        myId,
        reportMessage.isPending,
        t,
      ],
    );

    return (
      <>
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
          <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
            <Pressable
              style={[styles.sheet, { paddingBottom: insets.bottom }]}
              onPress={() => undefined}
              accessible={false}
              focusable={false}
              accessibilityViewIsModal
              importantForAccessibility="yes"
            >
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.keyboardWrap}
              >
                <View style={styles.header}>
                  <Text style={styles.title} accessibilityRole="header">
                    {t('roomChat.title')}
                  </Text>
                  <Pressable
                    onPress={onClose}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('roomChat.closeA11y')}
                    style={styles.closeButton}
                  >
                    <MaterialIcons name="close" size={22} color={colors.text} />
                  </Pressable>
                </View>
                <FlatList
                  ref={listRef}
                  data={messages}
                  renderItem={renderItem}
                  keyExtractor={m => m.id}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  initialNumToRender={20}
                  maxToRenderPerBatch={20}
                  windowSize={11}
                  removeClippedSubviews
                  accessibilityRole="list"
                  accessibilityLabel={t('roomChat.messagesA11y')}
                />
                {replyTo ? (
                  <View style={styles.replyBanner} accessibilityLiveRegion="polite">
                    <View style={styles.replyBannerFlex}>
                      <Text style={styles.replyBannerLabel}>
                        {t('roomChat.replyingTo', {
                          name: replyTo.user.username || replyTo.user.displayName,
                        })}
                      </Text>
                      <Text style={styles.replyBannerSnippet} numberOfLines={1}>
                        {replyTo.content}
                      </Text>
                    </View>
                    <Pressable
                      onPress={handleCancelReply}
                      accessibilityRole="button"
                      accessibilityLabel={t('roomChat.cancelReplyA11y')}
                      hitSlop={8}
                      style={styles.replyCancelButton}
                    >
                      <MaterialIcons name="close" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ) : null}
                {canPost ? (
                  <View style={styles.composer}>
                    <TextInput
                      value={draft}
                      onChangeText={setDraft}
                      placeholder={
                        replyTo ? t('roomChat.replyPlaceholder') : t('roomChat.inputPlaceholder')
                      }
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                      multiline
                      maxLength={MAX_MESSAGE_LENGTH}
                      accessibilityLabel={t('roomChat.inputA11y')}
                    />
                    <Pressable
                      onPress={handleSend}
                      disabled={sendDisabled}
                      accessibilityRole="button"
                      accessibilityLabel={t('roomChat.sendA11y')}
                      accessibilityState={{
                        busy: sendMessage.isPending,
                        disabled: sendDisabled,
                      }}
                      style={[styles.sendBtn, !hasSendableDraft ? styles.sendBtnDisabled : null]}
                    >
                      {sendMessage.isPending ? (
                        <ActivityIndicator size="small" color={colors.onPrimary} />
                      ) : (
                        <MaterialIcons name="send" size={18} color={colors.onPrimary} />
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <View
                    style={styles.composerDisabled}
                    accessible
                    accessibilityRole="text"
                    accessibilityLiveRegion="polite"
                    accessibilityLabel={cantPostNotice}
                  >
                    <MaterialIcons name="lock" size={16} color={colors.textMuted} />
                    <Text style={styles.composerDisabledText}>{cantPostNotice}</Text>
                  </View>
                )}
              </KeyboardAvoidingView>
            </Pressable>
          </Pressable>
        </Modal>
        <ContentReportSheet
          visible={reportMessageId !== null}
          submitting={reportMessage.isPending}
          onClose={() => setReportMessageId(null)}
          onSelect={handleReportReason}
        />
      </>
    );
  },
);
RoomChatSidebar.displayName = 'RoomChatSidebar';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.modalBackdrop,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    backgroundColor: colors.surfaceHigh,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '70%',
  },
  keyboardWrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.glassStrong,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  bubble: {
    flex: 1,
    backgroundColor: colors.glass,
    padding: spacing.sm,
    borderRadius: 12,
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  author: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  messageActions: { flexDirection: 'row', alignItems: 'center' },
  messageAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { color: colors.text, fontSize: 14, lineHeight: 18 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.glassStrong,
  },
  composerDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.glassStrong,
  },
  composerDisabledText: { color: colors.textMuted, fontSize: 13 },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    maxHeight: 100,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.overlayWhite10 },
  replyQuote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    paddingLeft: 8,
    marginBottom: 4,
    opacity: 0.8,
  },
  replyAuthor: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  replySnippet: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.glassStrong,
    backgroundColor: withAlpha(colors.accent, 0.05),
  },
  replyBannerLabel: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  replyBannerSnippet: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  replyBannerFlex: { flex: 1 },
  replyCancelButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
