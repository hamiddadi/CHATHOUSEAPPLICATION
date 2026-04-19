import React, { memo, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar } from '../../../shared/components/Avatar';
import { Button } from '../../../shared/components/Button';
import { colors } from '../../../shared/constants/theme';
import type { FollowerOnMap } from '../../../shared/types/domain';

interface FollowerMiniCardProps {
  follower: FollowerOnMap;
  onJoinRoom: (roomId: string) => void;
  onSendMessage: (userId: string) => void;
  onClose: () => void;
}

/**
 * Floating card shown above the tab bar when a pin is tapped.
 * Two primary actions: join the follower's live room (if any) or open a DM.
 */
export const FollowerMiniCard: React.FC<FollowerMiniCardProps> = memo(
  ({ follower, onJoinRoom, onSendMessage, onClose }) => {
    const handleJoinRoom = useCallback(() => {
      if (follower.liveRoomId) onJoinRoom(follower.liveRoomId);
    }, [follower.liveRoomId, onJoinRoom]);

    const handleMessage = useCallback(
      () => onSendMessage(follower.id),
      [follower.id, onSendMessage],
    );

    return (
      <View className="bg-surface-highest/95 border border-overlay-white-10 rounded-xl p-lg gap-md shadow-glow-primary">
        <View className="flex-row items-center gap-md">
          <Avatar
            uri={follower.avatarUrl ?? undefined}
            name={follower.displayName}
            size="lg"
            status={follower.presence === 'online' ? 'online' : 'none'}
          />
          <View className="flex-1">
            <Text className="text-md font-body-bold text-ink" numberOfLines={1}>
              {follower.displayName}
            </Text>
            <Text className="text-xs font-body text-ink-muted" numberOfLines={1}>
              {follower.liveRoomTitle
                ? `🎙️ In "${follower.liveRoomTitle}"`
                : follower.presence === 'online'
                  ? '🟢 Online'
                  : `${follower.lastSeenMinutesAgo}m ago`}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
          >
            <MaterialIcons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        <View className="flex-row gap-sm">
          {follower.liveRoomId && (
            <View className="flex-1">
              <Button
                label="Join Room"
                variant="primary"
                size="sm"
                fullWidth
                leftIcon={<MaterialIcons name="mic" size={14} color={colors.onPrimary} />}
                onPress={handleJoinRoom}
              />
            </View>
          )}
          <View className="flex-1">
            <Button
              label="Message"
              variant={follower.liveRoomId ? 'ghost' : 'primary'}
              size="sm"
              fullWidth
              leftIcon={
                <MaterialIcons
                  name="chat-bubble-outline"
                  size={14}
                  color={follower.liveRoomId ? colors.text : colors.onPrimary}
                />
              }
              onPress={handleMessage}
            />
          </View>
        </View>
      </View>
    );
  },
);
FollowerMiniCard.displayName = 'FollowerMiniCard';
