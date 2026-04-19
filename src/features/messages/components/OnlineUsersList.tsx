import React, { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../../../shared/constants/theme';
import { AVATARS_10 } from '../../../shared/constants/images';
import type { MessageStackParamList } from '../../../core/navigation/types';
import { PulsingAvatar } from './PulsingAvatar';

/* ============================================================
 * Constants — Chathouse dark theme via theme tokens
 * ========================================================== */
const ITEM_SIZE = 60;
const ITEM_GAP = 16;
const HORIZONTAL_PADDING = 16;
const MAX_NAME_CHARS = 8;

const BG_COLOR = colors.surfaceAlt; // #191d3b
const TITLE_COLOR = colors.textMuted; // #c2c6d7
const NAME_COLOR = colors.text; // #dee0ff
const SEPARATOR_COLOR = colors.borderSoft; // rgba(255,255,255,0.1)

type Nav = NativeStackNavigationProp<MessageStackParamList, 'MessagesList'>;

export interface OnlineUser {
  id: string;
  name: string;
  avatar: string;
}

const DEFAULT_ONLINE_USERS: readonly OnlineUser[] = [
  { id: '1', name: 'Amira', avatar: AVATARS_10[5] ?? '' },
  { id: '2', name: 'Youssef', avatar: AVATARS_10[0] ?? '' },
  { id: '3', name: 'Sara', avatar: AVATARS_10[6] ?? '' },
  { id: '4', name: 'Karim', avatar: AVATARS_10[1] ?? '' },
  { id: '5', name: 'Nadia', avatar: AVATARS_10[7] ?? '' },
];

export interface OnlineUsersListProps {
  /** Defaults to a 5-user mock dataset when omitted. */
  users?: readonly OnlineUser[];
  /** Localized section title. Defaults to "Online". */
  title?: string;
  /** Resolve a chat conversation id from a user id. Defaults to `conv-{id}`. */
  resolveConversationId?: (userId: string) => string;
}

/* ============================================================
 * Item
 * ========================================================== */
interface UserItemProps {
  user: OnlineUser;
  onPress: (user: OnlineUser) => void;
}

const truncate = (name: string): string =>
  name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;

const UserItem: React.FC<UserItemProps> = memo(({ user, onPress }) => {
  const handlePress = useCallback(() => onPress(user), [onPress, user]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Open chat with ${user.name}`}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <PulsingAvatar avatar={user.avatar} size={ITEM_SIZE} dotBorderColor={BG_COLOR} />
      <Text style={styles.name} numberOfLines={1}>
        {truncate(user.name)}
      </Text>
    </Pressable>
  );
});
UserItem.displayName = 'UserItem';

/* ============================================================
 * List
 * ========================================================== */
export const OnlineUsersList: React.FC<OnlineUsersListProps> = memo(
  ({ users = DEFAULT_ONLINE_USERS, title = 'Online', resolveConversationId }) => {
    const navigation = useNavigation<Nav>();

    const handleOpenChat = useCallback(
      (user: OnlineUser) => {
        const conversationId = resolveConversationId
          ? resolveConversationId(user.id)
          : `conv-${user.id}`;
        navigation.navigate('ChatDetail', { conversationId });
      },
      [navigation, resolveConversationId],
    );

    const renderItem = useCallback(
      ({ item }: { item: OnlineUser }) => <UserItem user={item} onPress={handleOpenChat} />,
      [handleOpenChat],
    );
    const keyExtractor = useCallback((item: OnlineUser) => item.id, []);
    const renderSeparator = useCallback(() => <View style={styles.itemSeparator} />, []);

    return (
      <View style={styles.block}>
        <Text style={styles.title}>{title}</Text>
        <FlatList
          horizontal
          data={users}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={renderSeparator}
          contentContainerStyle={styles.listContent}
          showsHorizontalScrollIndicator={false}
        />
        <View style={styles.separator} />
      </View>
    );
  },
);
OnlineUsersList.displayName = 'OnlineUsersList';

const styles = StyleSheet.create({
  block: {
    backgroundColor: BG_COLOR,
    paddingTop: 12,
    paddingBottom: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: TITLE_COLOR,
    paddingHorizontal: HORIZONTAL_PADDING,
    marginBottom: 10,
    textTransform: 'none',
  },
  listContent: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 4,
  },
  itemSeparator: {
    width: ITEM_GAP,
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    width: ITEM_SIZE + 10,
  },
  itemPressed: {
    opacity: 0.7,
  },
  name: {
    fontSize: 11,
    color: NAME_COLOR,
    marginTop: 8,
    textAlign: 'center',
    maxWidth: ITEM_SIZE + 10,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: SEPARATOR_COLOR,
    marginTop: 12,
  },
});
