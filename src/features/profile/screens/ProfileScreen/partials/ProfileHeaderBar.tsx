import React, { memo } from 'react';
import { Pressable, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useTranslation } from 'react-i18next';
import { colors } from '../../../../../shared/constants/theme';

interface ProfileHeaderBarProps {
  /** Edit affordance only renders when viewing your own profile. */
  isSelf: boolean;
  onBack: () => void;
  onEdit: () => void;
  onShare: () => void;
  /** "More" (block/report) menu — only relevant for other users. */
  onMore: () => void;
}

const ProfileHeaderBar: React.FC<ProfileHeaderBarProps> = memo(
  ({ isSelf, onBack, onEdit, onShare, onMore }) => {
    const { t } = useTranslation();
    return (
      <View className="flex-row items-center justify-between px-xxl py-lg">
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View className="flex-row items-center gap-md">
          {isSelf && (
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel={t('profile.editProfile')}
              hitSlop={8}
            >
              <MaterialIcons name="edit" size={22} color={colors.text} />
            </Pressable>
          )}
          <Pressable
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Share profile"
            hitSlop={8}
          >
            <MaterialIcons name="share" size={22} color={colors.text} />
          </Pressable>
          {!isSelf && (
            <Pressable
              onPress={onMore}
              accessibilityRole="button"
              accessibilityLabel={t('profile.more')}
              hitSlop={8}
            >
              <MaterialIcons name="more-horiz" size={24} color={colors.text} />
            </Pressable>
          )}
        </View>
      </View>
    );
  },
);
ProfileHeaderBar.displayName = 'ProfileHeaderBar';

export default ProfileHeaderBar;
