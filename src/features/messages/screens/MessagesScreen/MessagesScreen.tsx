import React, { memo, useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../../../shared/components/Avatar';
import { Loader } from '../../../../shared/components/Loader';
import { EmptyState } from '../../../../shared/components/EmptyState';
import { colors, layout, spacing } from '../../../../shared/constants/theme';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import type { Conversation, UserSummary } from '../../../../shared/types/domain';
import { CURRENT_USER } from '../../../../shared/mocks/users.mock';
import { useAuthStore } from '../../../auth/store/authStore';
import { useConversations } from '../../hooks/useMessages';
import { useChatSocket } from '../../hooks/useChatSocket';
import { useGroups } from '../../hooks/useGroups';
import { useGroupSocket } from '../../hooks/useGroupSocket';
import type { GroupConversation } from '../../services/groupService';
import { OnlineUsersList } from '../../components/OnlineUsersList';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'MessagesList'>;

const otherParticipant = (c: Conversation): UserSummary => {
  const other = c.participants.find(p => p.id !== CURRENT_USER.id);
  return other ?? c.participants[0] ?? CURRENT_USER;
};

const relativeTime = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

interface ConvoRowProps {
  convo: Conversation;
  onPress: (id: string) => void;
}

const ConvoRow: React.FC<ConvoRowProps> = memo(({ convo, onPress }) => {
  const { t } = useTranslation();
  const handle = useCallback(() => onPress(convo.id), [convo.id, onPress]);
  // Voice notes have no text body — show a 🎤 marker instead of an empty line.
  let lastText = 'No messages yet';
  if (convo.lastMessage) {
    lastText = convo.lastMessage.kind === 'voice' ? t('voice.preview') : convo.lastMessage.text;
  }
  // Memoize the per-row derivations so they only recompute when the underlying
  // conversation changes (the row is memo()'d on props). Note: the relative
  // timestamp is intentionally frozen at render time — it refreshes whenever
  // the conversation updates (which is what reshuffles the list anyway), not on
  // a wall-clock tick. A global "now" ticker would be needed for live "2m → 3m"
  // counting; that is deliberately out of scope here.
  const other = useMemo(() => otherParticipant(convo), [convo]);
  const timeLabel = useMemo(() => relativeTime(convo.updatedAt), [convo.updatedAt]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={`Open chat with ${other.displayName}`}
      className="flex-row items-center gap-md px-xxl py-md"
    >
      <Avatar uri={other.avatarUrl ?? undefined} name={other.displayName} size="lg" />
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
            {other.displayName}
          </Text>
          <Text className="text-xxs font-body text-ink-muted">{timeLabel}</Text>
        </View>
        <View className="flex-row items-center justify-between mt-xxs">
          <Text
            className={
              convo.unreadCount > 0
                ? 'text-sm font-body-medium text-ink flex-1 mr-sm'
                : 'text-sm font-body text-ink-muted flex-1 mr-sm'
            }
            numberOfLines={1}
          >
            {lastText}
          </Text>
          {convo.unreadCount > 0 && (
            <View className="bg-primary rounded-pill px-xs min-w-[20px] items-center justify-center h-[20px]">
              <Text className="text-xxs font-body-bold text-primary-on-container">
                {convo.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
});
ConvoRow.displayName = 'ConvoRow';

interface GroupRowProps {
  group: GroupConversation;
  myId: string | null;
  onPress: (id: string) => void;
}

const GroupRow: React.FC<GroupRowProps> = memo(({ group, myId, onPress }) => {
  const { t } = useTranslation();
  const handle = useCallback(() => onPress(group.id), [group.id, onPress]);
  let lastText = 'No messages yet';
  if (group.lastMessage) {
    lastText =
      group.lastMessage.kind === 'voice' ? t('voice.preview') : (group.lastMessage.content ?? '');
  }
  const title = useMemo(() => {
    if (group.title) return group.title;
    const others = group.members.filter(m => m.id !== myId);
    return others.map(m => m.displayName || m.username).join(', ') || 'Group';
  }, [group.members, group.title, myId]);
  const timeLabel = useMemo(() => relativeTime(group.updatedAt), [group.updatedAt]);
  return (
    <Pressable
      onPress={handle}
      accessibilityRole="button"
      accessibilityLabel={`Open group ${title}`}
      className="flex-row items-center gap-md px-xxl py-md"
    >
      <View className="w-12 h-12 rounded-full bg-primary/15 items-center justify-center">
        <MaterialIcons name="groups" size={24} color={colors.primary} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
            {title}
          </Text>
          <Text className="text-xxs font-body text-ink-muted">{timeLabel}</Text>
        </View>
        <View className="flex-row items-center justify-between mt-xxs">
          <Text
            className={
              group.unreadCount > 0
                ? 'text-sm font-body-medium text-ink flex-1 mr-sm'
                : 'text-sm font-body text-ink-muted flex-1 mr-sm'
            }
            numberOfLines={1}
          >
            {lastText}
          </Text>
          {group.unreadCount > 0 && (
            <View className="bg-primary rounded-pill px-xs min-w-[20px] items-center justify-center h-[20px]">
              <Text className="text-xxs font-body-bold text-primary-on-container">
                {group.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
});
GroupRow.displayName = 'GroupRow';

export const MessagesScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // Subscribe to realtime chat events while the screen is mounted — this
  // invalidates the conversations query on every incoming message so the
  // list reshuffles without a manual pull-to-refresh.
  useChatSocket();
  useGroupSocket();
  const myId = useAuthStore(s => s.user?.id ?? null);
  const { data: conversations, isLoading, isError, refetch, isFetching } = useConversations();
  const { data: groups } = useGroups();

  const handleOpen = useCallback(
    (conversationId: string) => navigation.navigate('ChatDetail', { conversationId }),
    [navigation],
  );
  const handleOpenGroup = useCallback(
    (conversationId: string) => navigation.navigate('GroupChat', { conversationId }),
    [navigation],
  );

  // Start a NEW conversation: the picker screen searches users and routes to
  // ChatDetail with the chosen peer id (DM is gated server-side on mutual
  // follow, surfaced inside ChatDetail).
  const handleNewChat = useCallback(() => navigation.navigate('NewMessage'), [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => <ConvoRow convo={item} onPress={handleOpen} />,
    [handleOpen],
  );
  const keyExtractor = useCallback((item: Conversation) => item.id, []);
  const renderSeparator = useCallback(
    () => <View className="h-px bg-overlay-white-5 ml-[76px]" />,
    [],
  );

  // Header = online-users strip + a "Groups" section (group DMs live in their
  // own backend tables, so they're rendered above the 1:1 conversation list).
  const ListHeader = (
    <View>
      <OnlineUsersList />
      {groups && groups.length > 0 ? (
        <View className="pt-sm">
          <Text className="px-xxl pb-xs text-xs font-body-bold uppercase tracking-widest text-ink-muted">
            {t('messages.groups', 'Groups')}
          </Text>
          {groups.map(g => (
            <GroupRow key={g.id} group={g} myId={myId} onPress={handleOpenGroup} />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Text className="text-xxl font-display text-ink tracking-tight">{t('messages.title')}</Text>
        <Pressable
          onPress={handleNewChat}
          accessibilityRole="button"
          accessibilityLabel={t('messages.newChatA11y')}
          hitSlop={8}
          className="w-10 h-10 rounded-pill bg-overlay-white-10 items-center justify-center"
        >
          <MaterialIcons name="edit" size={20} color={colors.text} />
        </Pressable>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel={t('common.loading')} />
      ) : isError ? (
        <EmptyState title={t('messages.couldNotLoad')} description={t('messages.pullToRetry')} />
      ) : (
        <FlatList
          data={conversations ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            (groups?.length ?? 0) === 0 ? (
              <EmptyState title={t('messages.empty')} description={t('messages.startHint')} />
            ) : null
          }
          refreshing={isFetching}
          onRefresh={refetch}
          contentContainerStyle={[
            styles.list,
            {
              paddingBottom:
                insets.bottom + layout.tabBarHeight + layout.tabBarBottomOffset + spacing.huge,
            },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  list: { paddingVertical: spacing.sm },
});
