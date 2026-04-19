import React from 'react';
import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Input } from '../../../shared/components/Input';
import { colors } from '../../../shared/constants/theme';

interface MapSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
}

/**
 * Glass search bar anchored at the top of the map canvas.
 * Filtering is handled by the parent (MapsScreen) to keep marker centering logic colocated.
 */
export const MapSearchBar: React.FC<MapSearchBarProps> = ({ value, onChangeText }) => (
  <View className="bg-overlay-white-5 border border-overlay-white-10 rounded-pill">
    <Input
      value={value}
      onChangeText={onChangeText}
      placeholder="Find a friend..."
      variant="outlined"
      size="md"
      leftAdornment={<MaterialIcons name="search" size={18} color={colors.textMuted} />}
    />
  </View>
);
