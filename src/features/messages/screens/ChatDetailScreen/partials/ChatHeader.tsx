import React, { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '../../../../../shared/constants/theme';
import { DEFAULTS } from '../../../../../shared/constants/images';

const HEADER_ICON_SIZE = 22;
const AVATAR_HEADER_SIZE = 40;
const STATUS_DOT_SIZE = 10;

interface ChatHeaderProps {
  /** Top safe-area inset; the header adds spacing.sm on top of it. */
  topInset: number;
  otherAvatar: string | null;
  isOnline: boolean;
  /** When true, the subtitle shows a live "typing…" hint instead of @username. */
  isTyping?: boolean;
  displayName?: string;
  username?: string;
  onBack: () => void;
  onCall: () => void;
  onMore: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = memo(
  ({
    topInset,
    otherAvatar,
    isOnline,
    isTyping,
    displayName,
    username,
    onBack,
    onCall,
    onMore,
  }) => {
    const { t } = useTranslation();

    return (
      <View style={[styles.header, { paddingTop: topInset + spacing.sm }]}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={onBack}
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
              resizeMode="cover"
            />
            {isOnline && <View style={styles.headerStatusDot} />}
          </View>
          <View>
            <Text className="text-md font-display text-primary tracking-tight">
              {displayName ?? 'Chat'}
            </Text>
            {isTyping ? (
              <Text className="text-xs font-body-medium text-accent">{t('chat.typing')}</Text>
            ) : (
              <Text className="text-xs font-body-medium text-ink-muted">@{username ?? 'user'}</Text>
            )}
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={onCall}
            accessibilityRole="button"
            accessibilityLabel={t('chat.callA11y')}
            hitSlop={8}
            className="p-sm rounded-pill active:bg-overlay-white-5"
          >
            <MaterialIcons name="call" size={HEADER_ICON_SIZE} color={colors.primary} />
          </Pressable>
          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel={t('chat.moreA11y')}
            hitSlop={8}
            className="p-sm rounded-pill active:bg-overlay-white-5"
          >
            <MaterialIcons name="more-vert" size={HEADER_ICON_SIZE} color={colors.primary} />
          </Pressable>
        </View>
      </View>
    );
  },
);
ChatHeader.displayName = 'ChatHeader';

const styles = StyleSheet.create({
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
});

export default ChatHeader;
