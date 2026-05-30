import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { useApiErrorToast } from '../../../../shared/hooks/useApiErrorToast';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import type { Message, UserSummary } from '../../../../shared/types/domain';
import { CURRENT_USER } from '../../../../shared/mocks/users.mock';
import { useAuthStore } from '../../../auth/store/authStore';
import { useConversation, useConversationMessages, useSendMessage } from '../../hooks/useMessages';
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

// Date label is locale-aware: i18n translates "Today"/"Yesterday", and
// Intl.DateTimeFormat gets the active app language so formatting matches
// the rest of the UI (not the device locale, which can differ).
const formatDateLabel = (
  iso: string,
  language: string,
  todayLabel: string,
  yesterdayLabel: string,
): string => {
  const today = new Date();
  const d = new Date(iso);
  if (sameDay(iso, today.toISOString())) return todayLabel;
  const yesterday = new Date(today.getTime() - 86400000);
  if (sameDay(iso, yesterday.toISOString())) return yesterdayLabel;
  return new Intl.DateTimeFormat(language, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(d);
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
  const { t, i18n } = useTranslation();
  // Identify "me" from the authenticated session, not a mock. Fall back to
  // the CURRENT_USER mock id only when there is no live session (tests /
  // unauthenticated render) so the participant resolution stays stable.
  const myId = useAuthStore(s => s.user?.id) ?? CURRENT_USER.id;

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
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

  const { data: conversation } = useConversation(route.params.conversationId);
  const { data: messages, isLoading } = useConversationMessages(route.params.conversationId);
  const sendMessage = useSendMessage();

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleSend = useCallback(async () => {
    if (!draft.trim() || sendMessage.isPending) return;
    try {
      await sendMessage.mutateAsync({
        conversationId: route.params.conversationId,
        text: draft,
      });
      setDraft('');
      scrollToEnd();
    } catch (err) {
      reportApiError(err);
    }
  }, [draft, reportApiError, route.params.conversationId, scrollToEnd, sendMessage]);

  // Features below are not yet implemented end-to-end (no voice infra,
  // no attachment upload pipeline). Rather than no-op handlers — which
  // make the buttons feel broken — we surface a single "Coming soon"
  // alert so the user gets immediate feedback. Replace each handler when
  // the underlying feature ships.
  const showComingSoon = useCallback((label: string) => {
    Alert.alert(label, 'Cette fonctionnalité arrive bientôt.');
  }, []);

  const handleCall = useCallback(() => showComingSoon('Appel vocal'), [showComingSoon]);
  const handleMore = useCallback(
    () => showComingSoon('Options de la conversation'),
    [showComingSoon],
  );
  const handleMicInput = useCallback(() => showComingSoon('Message vocal'), [showComingSoon]);
  const handleAttach = useCallback(() => showComingSoon('Pièce jointe'), [showComingSoon]);
  const handleEmoji = useCallback(() => {
    // Quick-insert: append a smiley to the draft. Real emoji picker is a
    // separate native module; this stop-gap keeps the button useful.
    setDraft(d => `${d}${d.length > 0 && !d.endsWith(' ') ? ' ' : ''}🙂`);
  }, []);

  const other: UserSummary | undefined =
    conversation?.participants.find(p => p.id !== myId) ?? conversation?.participants[0];
  const otherAvatar = other?.avatarUrl ?? null;

  const items = useMemo(() => buildChatItems(messages ?? []), [messages]);

  const todayLabel = t('chat.dateToday');
  const yesterdayLabel = t('chat.dateYesterday');
  const language = i18n.language;

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.kind === 'date' && item.date) {
        return (
          <DateSeparator label={formatDateLabel(item.date, language, todayLabel, yesterdayLabel)} />
        );
      }
      if (item.message) {
        return (
          <Bubble
            message={item.message}
            otherAvatar={otherAvatar}
            showAvatar={item.showAvatar ?? true}
          />
        );
      }
      return null;
    },
    [language, otherAvatar, todayLabel, yesterdayLabel],
  );

  const keyExtractor = useCallback((item: ChatListItem) => item.id, []);

  // Presence is not yet wired into the DM thread. The conversation payload
  // carries no per-peer online flag, so we must not assert a green "online"
  // dot unconditionally — that was a misleading indicator. Until a real
  // presence source is plumbed through, treat the peer as offline (dot
  // hidden).
  // TODO(audit): wire to a real presence source (e.g. extensions presence
  // API / socket presence events) instead of defaulting to offline.
  const isOnline = false;
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
        displayName={other?.displayName}
        username={other?.username}
        onBack={handleBack}
        onCall={handleCall}
        onMore={handleMore}
      />

      {isLoading ? (
        <Loader fullscreen accessibilityLabel="Loading messages" />
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={styles.flex1}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
        />
      )}

      <ChatInputBar
        value={draft}
        onChangeText={setDraft}
        onSend={handleSend}
        canSend={canSend}
        bottomInset={insets.bottom}
        keyboardVisible={keyboardVisible}
        onEmoji={handleEmoji}
        onAttach={handleAttach}
        onMic={handleMicInput}
        onInputFocus={scrollToEnd}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  kav: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  list: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    gap: spacing.xl,
  },
});
