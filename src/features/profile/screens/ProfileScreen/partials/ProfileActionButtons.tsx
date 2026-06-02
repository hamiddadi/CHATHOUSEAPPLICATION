import React, { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../../shared/components/Button';

interface ProfileActionButtonsProps {
  isFollowedByMe: boolean;
  /** Drives the Follow/Following button spinner. */
  followLoading: boolean;
  /** Disables the wave button while the mutation is in flight. */
  waveLoading: boolean;
  onToggleFollow: () => void;
  onWave: () => void;
}

const ProfileActionButtons: React.FC<ProfileActionButtonsProps> = memo(
  ({ isFollowedByMe, followLoading, waveLoading, onToggleFollow, onWave }) => {
    const { t } = useTranslation();
    return (
      <View className="flex-row items-center gap-sm mt-md w-full">
        <View className="flex-1">
          <Button
            label={isFollowedByMe ? 'Following' : 'Follow'}
            variant={isFollowedByMe ? 'ghost' : 'primary'}
            size="md"
            fullWidth
            loading={followLoading}
            onPress={onToggleFollow}
          />
        </View>
        <Pressable
          onPress={onWave}
          accessibilityRole="button"
          accessibilityLabel={t('profile.wave')}
          disabled={waveLoading}
          className="w-11 h-11 rounded-pill bg-overlay-white-10 items-center justify-center"
        >
          <Text className="text-lg">🌊</Text>
        </Pressable>
      </View>
    );
  },
);
ProfileActionButtons.displayName = 'ProfileActionButtons';

export default ProfileActionButtons;
