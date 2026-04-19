import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../../shared/components/Avatar';
import { Input } from '../../../../shared/components/Input';
import { Loader } from '../../../../shared/components/Loader';
import { colors, spacing } from '../../../../shared/constants/theme';
import type { MessageStackParamList } from '../../../../core/navigation/types';
import type { Message, UserSummary } from '../../../../shared/types/domain';
import { CURRENT_USER } from '../../../../shared/mocks/users.mock';
import { useConversation, useConversationMessages, useSendMessage } from '../../hooks/useMessages';

type Nav = NativeStackNavigationProp<MessageStackParamList, 'ChatDetail'>;
type Route = RouteProp<MessageStackParamList, 'ChatDetail'>;

const Bubble: React.FC<{ message: Message }> = memo(({ message }) => (
  <View className={message.isMine ? 'items-end px-xxl py-xxs' : 'items-start px-xxl py-xxs'}>
    <View
      className={
        message.isMine
          ? 'bg-primary rounded-xxl rounded-br-sm px-lg py-md max-w-[80%]'
          : 'bg-surface-high rounded-xxl rounded-bl-sm px-lg py-md max-w-[80%]'
      }
    >
      <Text
        className={
          message.isMine
            ? 'text-sm font-body text-primary-on-container'
            : 'text-sm font-body text-ink'
        }
      >
        {message.text}
      </Text>
    </View>
  </View>
));
Bubble.displayName = 'Bubble';

export const ChatDetailScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
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
    } catch {
      // Handle via toast later.
    }
  }, [draft, route.params.conversationId, sendMessage]);

  const renderItem = useCallback(({ item }: { item: Message }) => <Bubble message={item} />, []);
  const keyExtractor = useCallback((item: Message) => item.id, []);

  const other: UserSummary | undefined = conversation?.participants.find(
    p => p.id !== CURRENT_USER.id,
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      style={styles.kav}
    >
      <View
        className="flex-row items-center gap-md px-xxl py-lg border-b border-overlay-white-5"
        style={{ paddingTop: insets.top + spacing.lg }}
      >
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Avatar
          uri={other?.avatarUrl ?? undefined}
          name={other?.displayName ?? 'Chat'}
          size="md"
          status="online"
        />
        <View className="flex-1">
          <Text className="text-md font-body-bold text-ink">{other?.displayName ?? 'Chat'}</Text>
          <Text className="text-xxs font-body text-accent">Online</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Chat options" hitSlop={8}>
          <MaterialIcons name="more-vert" size={24} color={colors.text} />
        </Pressable>
      </View>

      {isLoading ? (
        <Loader fullscreen accessibilityLabel="Loading messages" />
      ) : (
        <FlatList
          data={messages ?? []}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={styles.flex1}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View
        className="flex-row items-center gap-sm px-xxl py-md border-t border-overlay-white-5 bg-background"
        style={{ paddingBottom: keyboardVisible ? spacing.md : insets.bottom + spacing.md }}
      >
        <View className="flex-1">
          <Input placeholder="Message…" value={draft} onChangeText={setDraft} variant="filled" />
        </View>
        <Pressable
          onPress={handleSend}
          disabled={!draft.trim() || sendMessage.isPending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          className={
            draft.trim() && !sendMessage.isPending
              ? 'w-11 h-11 rounded-pill bg-primary items-center justify-center'
              : 'w-11 h-11 rounded-pill bg-surface-high items-center justify-center opacity-50'
          }
        >
          <MaterialIcons name="send" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  kav: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  list: { paddingVertical: spacing.md, flexGrow: 1 },
});
