import '../../global.css';
import React, { useCallback, useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useAppFonts } from '../shared/hooks/useAppFonts';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';

// Keep the splash screen visible while fonts and auth state load.
void SplashScreen.preventAutoHideAsync();

export const App: React.FC = () => {
  const { loaded, error } = useAppFonts();

  const onLayoutRootView = useCallback(() => {
    if (loaded || error) {
      void SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (loaded || error) {
      void SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <AppProviders>
      <RootNavigator onReady={onLayoutRootView} />
    </AppProviders>
  );
};
