import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'react-native';
import { useAuthStore } from '../../features/auth/store/authStore';
import { AccountRestorationGate, LegalAcceptanceGate } from '../../features/privacy';
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

  if (isHydrating) {
    return <AnimatedSplashScreen />;
  }

  const isAuthenticated = status === 'authenticated';
  // Killing the app between OTP verification and picking a handle restarts
  // as 'authenticated' with an empty username (authService maps a null
  // backend username to ''). Route those users back to the Auth stack —
  // opened directly on the Username step via `initialState` below — instead
  // of Onboarding/Main, otherwise the handle step is skipped forever.
  const needsUsername = isAuthenticated && user !== null && !user.username;
  // Treat missing `user` (hydrated from a stale token before refreshMe
  // resolved) as "onboarded" to avoid blocking returning users. New
  // users always have user populated via verifyOtp, so the gate fires
  // correctly for them.
  const needsOnboarding = isAuthenticated && user !== null && user.hasCompletedOnboarding === false;

  const screen =
    !isAuthenticated || needsUsername ? 'Auth' : needsOnboarding ? 'Onboarding' : 'Main';

  // `initialState` is only read when the container mounts — which is exactly
  // the cold-start case above (while hydrating we render the splash, so the
  // container mounts after auth state is known). setUsername() then flips
  // `needsUsername` off and the stack swaps to Onboarding/Main as usual.
  const initialState = needsUsername
    ? { routes: [{ name: 'Auth' as const, state: { routes: [{ name: 'Username' as const }] } }] }
    : undefined;

  return (
    <NavigationContainer
      linking={linking}
      initialState={initialState}
      onReady={onReady}
      fallback={<Loader fullscreen />}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      {/* RGPD grace-period restoration prompt — offers "Restore my account" when
          a soft-deleted user signs back in within the 30-day window. */}
      <AccountRestorationGate />
      <LegalAcceptanceGate />

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
