import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { useApiErrorToast } from '../../../../shared/hooks/useApiErrorToast';
import { colors, spacing } from '../../../../shared/constants/theme';
import { DEFAULTS } from '../../../../shared/constants/images';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import type { Message, UserSummary } from '../../../../shared/types/domain';
import { CURRENT_USER } from '../../../../shared/mocks/users.mock';
import { useAuthStore } from '../../../auth/store/authStore';
import { useConversation, useConversationMessages, useSendMessage } from '../../hooks/useMessages';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'ChatDetail'>;
type Route = RouteProp<MessageStackParamList, 'ChatDetail'>;

const HEADER_ICON_SIZE = 22;
const AVATAR_HEADER_SIZE = 40;
const AVATAR_BUBBLE_SIZE = 32;
const STATUS_DOT_SIZE = 10;
const BUBBLE_CORNER = 20;
const INPUT_ICON_SIZE = 22;
const SEND_BTN_SIZE = 44;

const GLASS_BG = 'rgba(255,255,255,0.05)';
const SENT_GRADIENT = ['rgba(176,198,255,0.2)', 'rgba(85,141,255,0.3)'] as const;
const SEND_GRADIENT = ['#b0c6ff', '#558dff'] as const;

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${m.toString().padStart(2, '0')} ${suffix}`;
};

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

interface BubbleProps {
  message: Message;
  otherAvatar: string | null;
  showAvatar: boolean;
}

const Bubble: React.FC<BubbleProps> = memo(({ message, otherAvatar, showAvatar }) => {
  if (message.isMine) {
    return (
      <View style={styles.sentRow}>
        <LinearGradient
          colors={SENT_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.sentBubble}
        >
          <Text className="text-sm font-body text-white leading-relaxed">{message.text}</Text>
        </LinearGradient>
        <View style={styles.metaRowRight}>
          <Text className="text-[10px] text-ink-muted">{formatTime(message.sentAt)}</Text>
          <MaterialIcons name="done-all" size={12} color={colors.primary} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.receivedRow}>
      {showAvatar ? (
        <Image
          source={{ uri: otherAvatar ?? DEFAULTS.avatar }}
          style={styles.receivedAvatar}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={styles.receivedAvatarPlaceholder} />
      )}
      <View style={styles.receivedContent}>
        <View style={styles.receivedBubble}>
          <Text className="text-sm font-body text-ink leading-relaxed">{message.text}</Text>
        </View>
        <Text className="text-[10px] text-ink-muted ml-xs mt-xxs">
          {formatTime(message.sentAt)}
        </Text>
      </View>
    </View>
  );
});
Bubble.displayName = 'Bubble';

interface DateSeparatorProps {
  label: string;
}

const DateSeparator: React.FC<DateSeparatorProps> = memo(({ label }) => (
  <View style={styles.dateSeparator}>
    <Text className="text-[10px] font-body-bold text-ink-muted uppercase tracking-widest">
      {label}
    </Text>
  </View>
));
DateSeparator.displayName = 'DateSeparator';

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
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={t('chat.backA11y')}
            hitSlop={8}
            className="w-10 h-10 rounded-pill items-center justify-center active:bg-overlay-white-5"
          >
            <MaterialIcons name="arrow-back" size={HEADER_ICON_SIZE} color={colors.primary} />
          </Pressable>
          <View style={styles.headerAvatarWrapper}>
            <Image
              source={{ uri: otherAvatar ?? DEFAULTS.avatar }}
              style={styles.headerAvatar}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
            />
            {isOnline && <View style={styles.headerStatusDot} />}
          </View>
          <View>
            <Text className="text-md font-display text-primary tracking-tight">
              {other?.displayName ?? 'Chat'}
            </Text>
            <Text className="text-xs font-body-medium text-ink-muted">
              @{other?.username ?? 'user'}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={handleCall}
            accessibilityRole="button"
            accessibilityLabel={t('chat.callA11y')}
            hitSlop={8}
            className="p-sm rounded-pill active:bg-overlay-white-5"
          >
            <MaterialIcons name="call" size={HEADER_ICON_SIZE} color={colors.primary} />
          </Pressable>
          <Pressable
            onPress={handleMore}
            accessibilityRole="button"
            accessibilityLabel={t('chat.moreA11y')}
            hitSlop={8}
            className="p-sm rounded-pill active:bg-overlay-white-5"
          >
            <MaterialIcons name="more-vert" size={HEADER_ICON_SIZE} color={colors.primary} />
          </Pressable>
        </View>
      </View>

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

      <View
        style={[
          styles.footer,
          { paddingBottom: keyboardVisible ? spacing.md : insets.bottom + spacing.md },
        ]}
      >
        <View style={styles.inputPill}>
          <Pressable
            onPress={handleEmoji}
            accessibilityRole="button"
            accessibilityLabel={t('chat.emojiA11y')}
            hitSlop={8}
          >
            <MaterialIcons
              name="sentiment-satisfied"
              size={INPUT_ICON_SIZE}
              color={colors.textMuted}
            />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder={t('chat.inputPlaceholder')}
            placeholderTextColor={'rgba(194,198,215,0.5)'}
            value={draft}
            onChangeText={setDraft}
            onFocus={scrollToEnd}
            multiline
          />
          <Pressable
            onPress={handleAttach}
            accessibilityRole="button"
            accessibilityLabel={t('chat.attachA11y')}
            hitSlop={8}
          >
            <MaterialIcons name="attach-file" size={INPUT_ICON_SIZE} color={colors.textMuted} />
          </Pressable>
        </View>
        {canSend ? (
          <Pressable
            onPress={handleSend}
            accessibilityRole="button"
            accessibilityLabel={t('chat.sendA11y')}
            disabled={!canSend}
            className="rounded-pill overflow-hidden active:opacity-90"
          >
            <LinearGradient
              colors={SEND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sendBtn}
            >
              <MaterialIcons name="send" size={INPUT_ICON_SIZE} color={colors.onPrimary} />
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleMicInput}
            accessibilityRole="button"
            accessibilityLabel={t('chat.micA11y')}
            style={styles.micBtn}
          >
            <MaterialIcons name="mic" size={INPUT_ICON_SIZE} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  kav: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(12,17,46,0.8)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  headerAvatarWrapper: {
    position: 'relative',
  },
  headerAvatar: {
    width: AVATAR_HEADER_SIZE,
    height: AVATAR_HEADER_SIZE,
    borderRadius: 10,
    backgroundColor: colors.surfaceHighest,
  },
  headerStatusDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: STATUS_DOT_SIZE,
    height: STATUS_DOT_SIZE,
    borderRadius: STATUS_DOT_SIZE / 2,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.background,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  list: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
    gap: spacing.xl,
  },
  dateSeparator: {
    alignSelf: 'center',
    backgroundColor: GLASS_BG,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxs,
    borderRadius: 9999,
  },
  receivedRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    maxWidth: '85%',
  },
  receivedAvatar: {
    width: AVATAR_BUBBLE_SIZE,
    height: AVATAR_BUBBLE_SIZE,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: colors.surfaceHighest,
  },
  receivedAvatarPlaceholder: {
    width: AVATAR_BUBBLE_SIZE,
  },
  receivedContent: {
    flexShrink: 1,
  },
  receivedBubble: {
    backgroundColor: GLASS_BG,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: BUBBLE_CORNER,
    borderBottomLeftRadius: 4,
  },
  sentRow: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    maxWidth: '85%',
  },
  sentBubble: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: BUBBLE_CORNER,
    borderBottomRightRadius: 4,
  },
  metaRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xxs,
    marginRight: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: GLASS_BG,
    borderRadius: 9999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    minHeight: 44,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 0,
    maxHeight: 100,
  },
  sendBtn: {
    width: SEND_BTN_SIZE,
    height: SEND_BTN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: SEND_BTN_SIZE,
    height: SEND_BTN_SIZE,
    borderRadius: SEND_BTN_SIZE / 2,
    backgroundColor: GLASS_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
