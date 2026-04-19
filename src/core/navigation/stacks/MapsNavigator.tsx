import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MapStackParamList } from '../types';
import { colors } from '../../../shared/constants/theme';
import { MapsScreen } from '../../../features/maps/screens/MapsScreen';

const Stack = createNativeStackNavigator<MapStackParamList>();

export const MapsNavigator: React.FC = () => (
  <Stack.Navigator
    initialRouteName="Maps"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.background },
    }}
  >
    <Stack.Screen name="Maps" component={MapsScreen} />
  </Stack.Navigator>
);
