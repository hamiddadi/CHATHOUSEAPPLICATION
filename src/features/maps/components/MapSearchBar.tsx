import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';

const BRAND_NAVY = '#1E3A8A';
const PLACEHOLDER_COLOR = 'rgba(30,58,138,0.55)';

interface MapSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
}

/**
 * Outlined "Find a friend" pill — navy border, transparent fill, navy ink.
 * Parent (MapsScreen) owns the filtering to keep marker centering logic colocated.
 */
export const MapSearchBar: React.FC<MapSearchBarProps> = ({ value, onChangeText }) => (
  <View style={styles.container}>
    <MaterialIcons name="search" size={20} color={BRAND_NAVY} />
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      placeholder="Find a friend..."
      placeholderTextColor={PLACEHOLDER_COLOR}
      accessibilityLabel="Find a friend"
      returnKeyType="search"
    />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BRAND_NAVY,
    backgroundColor: 'transparent',
  },
  input: {
    flex: 1,
    color: BRAND_NAVY,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 0,
  },
});
