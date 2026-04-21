import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

const LOGO_ICON_SIZE = 24;
const BRAND_NAVY = '#1E3A8A';

/**
 * Header — Maps. Transparent background, navy brand mark only.
 * The Wave affordance was removed per spec; the header is display-only now.
 */
export const MapTopAppBar: React.FC = () => (
  <View className="flex-row items-center px-xxl py-lg">
    <View className="flex-row items-center gap-sm">
      <MaterialIcons name="graphic-eq" size={LOGO_ICON_SIZE} color={BRAND_NAVY} />
      <Text style={styles.titleText}>Chathouse</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  titleText: {
    color: BRAND_NAVY,
    fontSize: 22,
    fontWeight: '700',
  },
});
