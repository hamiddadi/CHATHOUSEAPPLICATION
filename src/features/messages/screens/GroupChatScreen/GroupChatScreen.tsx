import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import { useApiErrorToast } from '../../../../shared/hooks/useApiErrorToast';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import { useAuthStore } from '../../../auth/store/authStore';
import {
  useGroup,
  useGroupMessages,
  useMarkGroupRead,
  useSendGroupMessage,
} from '../../hooks/useGroups';
import type { GroupMessage } from '../../services/groupService';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'GroupChat'>;
type Route = RouteProp<MessageStackParamList, 'GroupChat'>;

export const GroupChatScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const conversationId = route.params.conversationId;
  const myId = useAuthStore(s => s.user?.id ?? null);

  const { data: group } = useGroup(conversationId);
  const { data: messages, isLoading } = useGroupMessages(conversationId);
  const send = useSendGroupMessage();
  const markRead = useMarkGroupRead();
  const toastError = useApiErrorToast();

  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<GroupMessage>>(null);

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

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft('');
    send.mutate(
      { conversationId, text },
      {
        // On failure, restore the text so the user doesn't silently lose their
        // message, and surface the error.
        onError: err => {
          setDraft(text);
          toastError(err);
        },
      },
    );
  }, [conversationId, draft, send, toastError]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleOpenInfo = useCallback(
    () => navigation.navigate('GroupInfo', { conversationId }),
    [conversationId, navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: GroupMessage }) => {
      const isMine = item.senderId === myId;
      return (
        <View className={isMine ? 'items-end px-xxl py-xxs' : 'items-start px-xxl py-xxs'}>
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
            <Text className={isMine ? 'text-sm text-primary-on-container' : 'text-sm text-ink'}>
              {item.content}
            </Text>
          </View>
        </View>
      );
    },
    [myId, nameById],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center gap-md px-xxl py-md border-b border-overlay-white-5">
        <Pressable onPress={handleBack} accessibilityRole="button" hitSlop={8}>
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
      ) : (
        <FlatList
          ref={listRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          inverted
          contentContainerStyle={{ paddingVertical: spacing.md }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View
        className="flex-row items-end gap-sm px-xxl py-sm border-t border-overlay-white-5"
        style={{ paddingBottom: insets.bottom + spacing.sm }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('messages.messagePlaceholder', 'Message')}
          placeholderTextColor={colors.textMuted}
          multiline
          className="flex-1 max-h-28 bg-overlay-white-5 rounded-2xl px-md py-sm text-ink"
        />
        <Pressable
          onPress={handleSend}
          disabled={draft.trim().length === 0 || send.isPending}
          accessibilityRole="button"
          accessibilityLabel={t('common.send', 'Send')}
          className={
            draft.trim().length === 0
              ? 'w-11 h-11 rounded-pill bg-overlay-white-10 items-center justify-center opacity-50'
              : 'w-11 h-11 rounded-pill bg-primary items-center justify-center'
          }
        >
          <MaterialIcons name="send" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
};
