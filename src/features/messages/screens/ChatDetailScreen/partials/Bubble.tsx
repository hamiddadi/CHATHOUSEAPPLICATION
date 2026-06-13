import React, { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { GradientView } from '../../../../../shared/components/GradientView';
import { colors, spacing } from '../../../../../shared/constants/theme';
import { DEFAULTS } from '../../../../../shared/constants/images';
import type { Message } from '../../../../../shared/types/domain';
import VoiceMessageBubble from '../../../components/VoiceMessageBubble';

const AVATAR_BUBBLE_SIZE = 32;
const BUBBLE_CORNER = 20;

const GLASS_BG = 'rgba(255,255,255,0.05)';
const SENT_GRADIENT = ['rgba(176,198,255,0.2)', 'rgba(85,141,255,0.3)'] as const;

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${m.toString().padStart(2, '0')} ${suffix}`;
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
        <GradientView
          colors={SENT_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.sentBubble}
        >
          {message.kind === 'voice' && message.audioUrl ? (
            <VoiceMessageBubble
              audioUrl={message.audioUrl}
              durationMs={message.durationMs}
              isMine
            />
          ) : (
            <Text className="text-sm font-body text-white leading-relaxed">{message.text}</Text>
          )}
        </GradientView>
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
          resizeMode="cover"
        />
      ) : (
        <View style={styles.receivedAvatarPlaceholder} />
      )}
      <View style={styles.receivedContent}>
        <View style={styles.receivedBubble}>
          {message.kind === 'voice' && message.audioUrl ? (
            <VoiceMessageBubble
              audioUrl={message.audioUrl}
              durationMs={message.durationMs}
              isMine={false}
            />
          ) : (
            <Text className="text-sm font-body text-ink leading-relaxed">{message.text}</Text>
          )}
        </View>
        <Text className="text-[10px] text-ink-muted ml-xs mt-xxs">
          {formatTime(message.sentAt)}
        </Text>
      </View>
    </View>
  );
});
Bubble.displayName = 'Bubble';

const styles = StyleSheet.create({
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
});

export default Bubble;
