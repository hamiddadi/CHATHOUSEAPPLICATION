import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../types';
import { colors } from '../../../shared/constants/theme';
import { SettingsScreen } from '../../../features/settings/screens/SettingsScreen';
import { ProfileScreen } from '../../../features/profile/screens/ProfileScreen';
import { EditProfileScreen } from '../../../features/profile/screens/EditProfileScreen';
import { FollowersScreen } from '../../../features/profile/screens/FollowersScreen';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export const SettingsNavigator: React.FC = () => (
  <Stack.Navigator
    initialRouteName="Settings"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.background },
    }}
  >
    <Stack.Screen name="Settings" component={SettingsScreen} />
    <Stack.Screen name="Profile" component={ProfileScreen} />
    <Stack.Screen name="EditProfile" component={EditProfileScreen} />
    <Stack.Screen name="Followers" component={FollowersScreen} />
  </Stack.Navigator>
);
