import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../../shared/constants/theme';
import { LandingScreen } from '../../features/auth/screens/LandingScreen';
import { PhoneScreen } from '../../features/auth/screens/PhoneScreen';
import { OtpScreen } from '../../features/auth/screens/OtpScreen';
import { UsernameScreen } from '../../features/auth/screens/UsernameScreen';
import { WaitlistScreen } from '../../features/auth/screens/WaitlistScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export const AuthNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="Landing"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Landing" component={LandingScreen} />
      <Stack.Screen name="Phone" component={PhoneScreen} />
      <Stack.Screen name="Otp" component={OtpScreen} />
      <Stack.Screen name="Username" component={UsernameScreen} />
      <Stack.Screen name="Waitlist" component={WaitlistScreen} />
    </Stack.Navigator>
  );
};
