import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../../shared/constants/theme';
import { SetupProfileScreen } from '../../features/onboarding/screens/SetupProfileScreen';
import { InterestSelectionScreen } from '../../features/onboarding/screens/InterestSelectionScreen';
import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export const OnboardingNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="Onboarding"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Onboarding" component={SetupProfileScreen} />
      <Stack.Screen name="InterestSelection" component={InterestSelectionScreen} />
    </Stack.Navigator>
  );
};
