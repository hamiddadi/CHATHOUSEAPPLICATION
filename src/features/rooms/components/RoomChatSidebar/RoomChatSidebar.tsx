import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { Avatar } from '../../../../shared/components/Avatar';
import { colors, spacing } from '../../../../shared/constants/theme';
import { getSocket } from '../../../../shared/services/realtime/socketClient';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { roomKeys, useRoomMessages, useSendRoomMessage } from '../../hooks/useRooms';

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
    // Can the viewer post? Chat must be on, and either open to all or the viewer
    // is a host/moderator. When they can't, we replace the composer with a note.
    const canPost = chatEnabled && (chatVisibility !== 'MODS_ONLY' || canModerate);
    const cantPostNotice = !chatEnabled
      ? 'Le chat est désactivé pour cette room.'
      : 'Le chat est réservé aux modérateurs.';
    const { data: messages = [] } = useRoomMessages(visible ? roomId : null);
    const sendMessage = useSendRoomMessage();
    const qc = useQueryClient();
    const [draft, setDraft] = useState('');
    const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
    const listRef = useRef<FlatList<ChatMessage>>(null);

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
      // Guard against a double-tap firing two mutations before isPending
      // flips (React state is async): otherwise the same message is sent
      // twice since the draft is only cleared in onSuccess.
      if (content.length === 0 || sendMessage.isPending) return;
      sendMessage.mutate(
        { roomId, content, replyToId: replyTo?.id },
        {
          onSuccess: () => {
            setDraft('');
            setReplyTo(null);
          },
          onError: e => Alert.alert('Erreur', errorMessage(e, "Échec de l'envoi")),
        },
      );
    }, [draft, roomId, replyTo, sendMessage]);

    const handleStartReply = useCallback((msg: ChatMessage) => setReplyTo(msg), []);
    const handleCancelReply = useCallback(() => setReplyTo(null), []);

    const renderItem = useCallback(
      ({ item }: { item: ChatMessage }) => (
        <Pressable
          onLongPress={() => handleStartReply(item)}
          accessibilityRole="button"
          accessibilityLabel={`Message de ${item.user.displayName}, appui long pour répondre`}
          style={styles.row}
        >
          <Avatar
            uri={item.user.avatarUrl ?? undefined}
            name={item.user.displayName}
            sizeValue={28}
          />
          <View style={styles.bubble}>
            <Text style={styles.author}>{item.user.displayName || item.user.username}</Text>
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
          </View>
        </Pressable>
      ),
      [handleStartReply],
    );

    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer le chat">
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.keyboardWrap}
            >
              <View style={styles.header}>
                <Text style={styles.title}>Chat de la room</Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Fermer"
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
              />
              {replyTo ? (
                <View style={styles.replyBanner}>
                  <View style={styles.replyBannerFlex}>
                    <Text style={styles.replyBannerLabel}>
                      Réponse à @{replyTo.user.username || replyTo.user.displayName}
                    </Text>
                    <Text style={styles.replyBannerSnippet} numberOfLines={1}>
                      {replyTo.content}
                    </Text>
                  </View>
                  <Pressable
                    onPress={handleCancelReply}
                    accessibilityRole="button"
                    accessibilityLabel="Annuler la réponse"
                    hitSlop={8}
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
                    placeholder={replyTo ? 'Réponse…' : 'Écrire…'}
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    multiline
                    maxLength={MAX_MESSAGE_LENGTH}
                    accessibilityLabel="Message de chat"
                  />
                  <Pressable
                    onPress={handleSend}
                    disabled={draft.trim().length === 0 || sendMessage.isPending}
                    accessibilityRole="button"
                    accessibilityLabel="Envoyer"
                    style={[
                      styles.sendBtn,
                      draft.trim().length === 0 || sendMessage.isPending
                        ? styles.sendBtnDisabled
                        : null,
                    ]}
                  >
                    <MaterialIcons name="send" size={18} color={colors.background} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.composerDisabled}>
                  <MaterialIcons name="lock" size={16} color={colors.textMuted} />
                  <Text style={styles.composerDisabledText}>{cantPostNotice}</Text>
                </View>
              )}
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);
RoomChatSidebar.displayName = 'RoomChatSidebar';

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
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
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  listContent: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  bubble: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: spacing.sm,
    borderRadius: 12,
  },
  author: { color: colors.textMuted, fontSize: 11, marginBottom: 2, fontWeight: '600' },
  content: { color: colors.text, fontSize: 14, lineHeight: 18 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  composerDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  composerDisabledText: { color: colors.textMuted, fontSize: 13 },
  input: {
    flex: 1,
    color: colors.text,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 100,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.1)' },
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
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,228,117,0.05)',
  },
  replyBannerLabel: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  replyBannerSnippet: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  replyBannerFlex: { flex: 1 },
});
