import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../../features/auth/store/authStore';
import { Loader } from '../../shared/components/Loader';
import { colors } from '../../shared/constants/theme';
import type { RootStackParamList } from './types';
import { linking } from './linking';
import { AuthNavigator } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';

const RootStack = createNativeStackNavigator<RootStackParamList>();

interface RootNavigatorProps {
  onReady?: () => void;
}

/**
 * RootNavigator
 * - Picks between AuthNavigator and MainNavigator based on auth state.
 * - Fires `onReady` once the nav container is mounted — used to hide the splash.
 */
export const RootNavigator: React.FC<RootNavigatorProps> = ({ onReady }) => {
  const status = useAuthStore(s => s.status);
  const isHydrating = useAuthStore(s => s.isHydrating);

  if (isHydrating) {
    return <Loader fullscreen />;
  }

  const isAuthenticated = status === 'authenticated';

  return (
    <NavigationContainer linking={linking} onReady={onReady} fallback={<Loader fullscreen />}>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}
      >
        {isAuthenticated ? (
          <RootStack.Screen name="Main" component={MainNavigator} />
        ) : (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};
