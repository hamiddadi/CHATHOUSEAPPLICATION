import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../../constants/theme';
import { useNetworkStore } from '../../services/network/networkStore';

/**
 * Thin top banner shown while the device is offline. Renders nothing when
 * online so it doesn't steal a pixel of screen real estate in the happy path.
 */
interface OfflineBannerProps {
  /** Participate in root layout instead of floating over screen content. */
  inline?: boolean;
  /** Add the status-bar inset when this is the first visible root banner. */
  includeSafeArea?: boolean;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  inline = false,
  includeSafeArea = false,
}) => {
  const isOnline = useNetworkStore(s => s.isOnline);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  if (isOnline) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        !inline && styles.anchor,
        inline
          ? {
              paddingTop: spacing.xs + (includeSafeArea ? insets.top : 0),
              paddingBottom: spacing.xs,
            }
          : { top: insets.top, paddingVertical: spacing.xs },
      ]}
      className="bg-warning/95 px-xxl"
    >
      <Text className="text-xs font-body-bold text-surface-highest text-center">
        {t('offline.banner')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 9998,
  },
});
