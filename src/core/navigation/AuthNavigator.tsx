import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../../shared/constants/theme';
import { Loader } from '../../shared/components/Loader';
import { LandingScreen } from '../../features/auth/screens/LandingScreen';
import { PhoneScreen } from '../../features/auth/screens/PhoneScreen';
import { OtpScreen } from '../../features/auth/screens/OtpScreen';
import { NameScreen } from '../../features/auth/screens/NameScreen';
import { UsernameScreen } from '../../features/auth/screens/UsernameScreen';
import { WaitlistScreen } from '../../features/auth/screens/WaitlistScreen';
import { WelcomeSlidesScreen } from '../../features/onboarding/screens/WelcomeSlidesScreen';
import { welcomeStorage } from '../../features/onboarding/services/welcomeStorage';
import { PrivacyPolicyScreen } from '../../features/privacy/screens/PrivacyPolicyScreen';
import { TermsScreen } from '../../features/privacy/screens/TermsScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * Pre-auth flow. The very first launch shows a pedagogical carousel
 * (WelcomeSlides) once; subsequent launches go straight to Landing. We
 * resolve which route to start at via an AsyncStorage read and keep a
 * loader visible while that resolves — it's a single sub-100ms read so
 * the user shouldn't notice.
 */
export const AuthNavigator: React.FC = () => {
  const [initialRoute, setInitialRoute] = useState<keyof AuthStackParamList | null>(null);

  useEffect(() => {
    welcomeStorage
      .hasSeen()
      .then(seen => setInitialRoute(seen ? 'Landing' : 'WelcomeSlides'))
      // If the read rejects unexpectedly, default to Landing so we never
      // leave the user stuck on a fullscreen Loader.
      .catch(() => setInitialRoute('Landing'));
  }, []);

  if (!initialRoute) return <Loader fullscreen />;

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="WelcomeSlides" component={WelcomeSlidesScreen} />
      <Stack.Screen name="Landing" component={LandingScreen} />
      <Stack.Screen name="Phone" component={PhoneScreen} />
      <Stack.Screen name="Otp" component={OtpScreen} />
      <Stack.Screen name="Name" component={NameScreen} />
      <Stack.Screen name="Username" component={UsernameScreen} />
      <Stack.Screen name="Waitlist" component={WaitlistScreen} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
    </Stack.Navigator>
  );
};
