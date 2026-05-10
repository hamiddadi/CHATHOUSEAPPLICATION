import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkStore } from '../../services/network/networkStore';

/**
 * Thin top banner shown while the device is offline. Renders nothing when
 * online so it doesn't steal a pixel of screen real estate in the happy path.
 */
export const OfflineBanner: React.FC = () => {
  const isOnline = useNetworkStore(s => s.isOnline);
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  if (isOnline) return null;
  return (
    <View
      pointerEvents="box-none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.anchor, { top: insets.top }]}
      className="bg-warning/95 px-xxl py-xs"
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
