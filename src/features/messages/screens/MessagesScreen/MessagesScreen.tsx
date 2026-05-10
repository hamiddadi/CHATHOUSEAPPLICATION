import React, { memo, useCallback } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { useConversations } from '../../hooks/useMessages';
import { useChatSocket } from '../../hooks/useChatSocket';
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
  const handle = useCallback(() => onPress(convo.id), [convo.id, onPress]);
  const other = otherParticipant(convo);
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
          <Text className="text-xxs font-body text-ink-muted">{relativeTime(convo.updatedAt)}</Text>
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
            {convo.lastMessage?.text ?? 'No messages yet'}
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

export const MessagesScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // Subscribe to realtime chat events while the screen is mounted — this
  // invalidates the conversations query on every incoming message so the
  // list reshuffles without a manual pull-to-refresh.
  useChatSocket();
  const { data: conversations, isLoading, isError, refetch } = useConversations();

  const handleOpen = useCallback(
    (conversationId: string) => navigation.navigate('ChatDetail', { conversationId }),
    [navigation],
  );

  // Starting a NEW conversation (vs opening an existing one) requires
  // a user-search step that the Messages stack doesn't expose. The
  // backend's mutual-follow rule means picking from "Following" is the
  // right shortcut — for now we point the user to the Explore surface
  // where they can find someone, then DM-from-profile.
  const handleNewChat = useCallback(() => {
    Alert.alert(
      'Nouvelle conversation',
      "Pour démarrer une discussion, ouvrez le profil d'un utilisateur (depuis Explore ou une room) et appuyez sur Message.",
      [{ text: 'OK' }],
    );
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Conversation }) => <ConvoRow convo={item} onPress={handleOpen} />,
    [handleOpen],
  );
  const keyExtractor = useCallback((item: Conversation) => item.id, []);
  const renderSeparator = useCallback(
    () => <View className="h-px bg-overlay-white-5 ml-[76px]" />,
    [],
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
          ListHeaderComponent={OnlineUsersList}
          refreshing={isLoading}
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
