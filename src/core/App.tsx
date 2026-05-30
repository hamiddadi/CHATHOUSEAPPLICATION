import '../../global.css';
import './i18n'; // Side-effect init — must run before any component mounts.
import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useAppFonts } from '../shared/hooks/useAppFonts';
import { probeBackendHealth } from '../shared/services/api/healthProbe';
import { startNetworkListener } from '../shared/services/network/networkStore';
import { ImpersonationBanner } from '../features/admin/components/ImpersonationBanner';
import { SocketStatusBanner } from '../features/rooms/components/SocketStatusBanner';
import { useAnalyticsConsentStore } from '../features/privacy';
import { initReporter, reportException } from './observability/reporter';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';

// Keep the splash screen visible while fonts and auth state load.
void SplashScreen.preventAutoHideAsync();

// Boot-time Sentry init. No-op in dev + when @sentry/react-native isn't
// installed or SENTRY_DSN isn't set.
initReporter();

// Boot-time NetInfo subscription. No-op if @react-native-community/netinfo
// isn't installed; the OfflineBanner simply never shows.
startNetworkListener();

// Hydrate the GDPR analytics-consent store. Default = disabled, so until
// the user opts in (Settings → Confidentialité → toggle), the reporter is
// silent. Resolves quickly since SecureStore reads are synchronous-ish.
// Capture the rejection so a failed SecureStore read (consent hydration)
// surfaces in the reporter instead of becoming an unhandled rejection.
void useAnalyticsConsentStore
  .getState()
  .hydrate()
  .catch(err => reportException(err, { phase: 'consent-hydrate' }));

export const App: React.FC = () => {
  const { loaded, error } = useAppFonts();

  // Single source of truth for hiding the NATIVE splash: the navigation
  // container's onReady (wired below as RootNavigator onReady). Hiding it
  // here too — on fonts-ready, before the nav is ready — would expose the
  // AnimatedSplashScreen during the fonts-ready/nav-not-ready window and
  // cause a transient visual flash. The AnimatedSplashScreen stays as a
  // cover while auth hydrates (onReady doesn't fire during hydration).
  const onLayoutRootView = useCallback(() => {
    if (loaded || error) {
      void SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (__DEV__) void probeBackendHealth();
  }, []);

  if (!loaded && !error) return null;

  return (
    <AppProviders>
      <View style={appStyles.container}>
        {/* Banners sit ABOVE the navigator so they're visible on every
            screen. Order matters: ImpersonationBanner (red, action-required)
            then SocketStatusBanner (yellow, transient network status).
            Insets are handled internally so they cohabit with status bar. */}
        <ImpersonationBanner />
        <SocketStatusBanner />
        <RootNavigator onReady={onLayoutRootView} />
      </View>
    </AppProviders>
  );
};

const appStyles = StyleSheet.create({
  container: { flex: 1 },
});
