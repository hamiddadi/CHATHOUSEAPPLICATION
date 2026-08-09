import React, { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../shared/constants/theme';
import { PulsingAvatar } from './PulsingAvatar';

/* ============================================================
 * Constants — ChatHouse dark theme via theme tokens
 * ========================================================== */
const ITEM_SIZE = 60;
const ITEM_GAP = 16;
const HORIZONTAL_PADDING = 16;
const MAX_NAME_CHARS = 8;

const BG_COLOR = colors.surfaceAlt; // #191d3b
const TITLE_COLOR = colors.textMuted; // #c2c6d7
const NAME_COLOR = colors.text; // #dee0ff
const SEPARATOR_COLOR = colors.borderSoft; // rgba(255,255,255,0.1)

export interface OnlineUser {
  /** Exact user id returned by GET /ext/presence/available. */
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface OnlineUsersListProps {
  /**
   * Online users mapped from the presence endpoint. When empty the band is not
   * rendered; there is deliberately no mock fallback.
   */
  users: readonly OnlineUser[];
  /** Localized section title. Defaults to "Online". */
  title?: string;
  /** Opens a DM using the exact backend peer id carried by the selected item. */
  onOpenChat: (peerId: string) => void;
}

/* ============================================================
 * Item
 * ========================================================== */
interface UserItemProps {
  user: OnlineUser;
  onPress: (peerId: string) => void;
}

const truncate = (name: string): string =>
  name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;

const UserItem: React.FC<UserItemProps> = memo(({ user, onPress }) => {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(user.peerId), [onPress, user.peerId]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t('messages.openChatA11y', {
        name: user.displayName,
        defaultValue: 'Open chat with {{name}}',
      })}
      accessibilityHint={t(
        'messages.onlineChatHint',
        'This person is currently available to chat.',
      )}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <PulsingAvatar avatar={user.avatarUrl} size={ITEM_SIZE} dotBorderColor={BG_COLOR} />
      <Text style={styles.name} numberOfLines={1}>
        {truncate(user.displayName)}
      </Text>
    </Pressable>
  );
});
UserItem.displayName = 'UserItem';

/* ============================================================
 * List
 * ========================================================== */
export const OnlineUsersList: React.FC<OnlineUsersListProps> = memo(
  ({ users, title, onOpenChat }) => {
    const { t } = useTranslation();
    const sectionTitle = title ?? t('messages.online', 'Online');

    const renderItem = useCallback(
      ({ item }: { item: OnlineUser }) => <UserItem user={item} onPress={onOpenChat} />,
      [onOpenChat],
    );
    const keyExtractor = useCallback((item: OnlineUser) => item.peerId, []);
    const renderSeparator = useCallback(() => <View style={styles.itemSeparator} />, []);

    if (users.length === 0) {
      return null;
    }

    return (
      <View style={styles.block}>
        <Text accessibilityRole="header" style={styles.title}>
          {sectionTitle}
        </Text>
        <FlatList
          horizontal
          accessibilityLabel={sectionTitle}
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
