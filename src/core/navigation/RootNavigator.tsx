import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'react-native';
import { useAuthStore } from '../../features/auth/store/authStore';
import { useExtColorScheme } from '../../features/extensions';
import { Loader } from '../../shared/components/Loader';
import { AnimatedSplashScreen } from '../../shared/components/AnimatedSplashScreen';
import { colors } from '../../shared/constants/theme';
import type { RootStackParamList } from './types';
import { linking } from './linking';
import { AuthNavigator } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';

const RootStack = createNativeStackNavigator<RootStackParamList>();

interface RootNavigatorProps {
  onReady?: () => void;
}

/**
 * RootNavigator
 * - Picks between AuthNavigator and MainNavigator based on auth state.
 * - Fires `onReady` once the nav container is mounted — this is the SINGLE
 *   signal used to hide the native splash (see App.tsx). While `isHydrating`
 *   we render AnimatedSplashScreen as a cover and `onReady` does NOT fire, so
 *   the native splash stays underneath until the real UI is mounted —
 *   avoiding the fonts-ready/nav-not-ready flash.
 */
export const RootNavigator: React.FC<RootNavigatorProps> = ({ onReady }) => {
  const status = useAuthStore(s => s.status);
  const isHydrating = useAuthStore(s => s.isHydrating);
  const user = useAuthStore(s => s.user);
  const colorScheme = useExtColorScheme();

  if (isHydrating) {
    return <AnimatedSplashScreen />;
  }

  const isAuthenticated = status === 'authenticated';
  // Treat missing `user` (hydrated from a stale token before refreshMe
  // resolved) as "onboarded" to avoid blocking returning users. New
  // users always have user populated via verifyOtp, so the gate fires
  // correctly for them.
  const needsOnboarding = isAuthenticated && user !== null && user.hasCompletedOnboarding === false;

  const screen = !isAuthenticated ? 'Auth' : needsOnboarding ? 'Onboarding' : 'Main';

  return (
    <NavigationContainer linking={linking} onReady={onReady} fallback={<Loader fullscreen />}>
      <StatusBar
        barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      <RootStack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}
      >
        {screen === 'Auth' && <RootStack.Screen name="Auth" component={AuthNavigator} />}
        {screen === 'Onboarding' && (
          <RootStack.Screen name="Onboarding" component={OnboardingNavigator} />
        )}
        {screen === 'Main' && <RootStack.Screen name="Main" component={MainNavigator} />}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};
