import '../../global.css';
import './i18n'; // Side-effect init — must run before any component mounts.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppFonts } from '../shared/hooks/useAppFonts';
import { probeBackendHealth } from '../shared/services/api/healthProbe';
import { startNetworkListener } from '../shared/services/network/networkStore';
import { ImpersonationBanner } from '../features/admin/components/ImpersonationBanner';
import { SocketStatusBanner } from '../features/rooms/components/SocketStatusBanner';
import { useAnalyticsConsentStore } from '../features/privacy';
import { setupForegroundPush } from '../features/notifications/services/pushNotifications';
import { initReporter, reportException } from './observability/reporter';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';

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

  // Fail-safe: never block the UI forever on font loading. On some devices
  // (slow Metro asset serving in dev, flaky asset resolution) `useFonts` can
  // stall without resolving or erroring, leaving the app stuck on the splash
  // with an empty React tree. After a short timeout we proceed anyway; the
  // design-system fonts simply fall back to the system font until they load.
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const ready = loaded || error !== null || fontTimeout;

  useEffect(() => {
    if (__DEV__) void probeBackendHealth();
  }, []);

  // Surface foreground FCM messages via notifee (de-Expo: replaces
  // expo-notifications' foreground handler). Returns the unsubscribe fn.
  useEffect(() => setupForegroundPush(), []);

  if (!ready) return null;

  return (
    <AppProviders>
      <View style={appStyles.container}>
        {/* Banners sit ABOVE the navigator so they're visible on every
            screen. Order matters: ImpersonationBanner (red, action-required)
            then SocketStatusBanner (yellow, transient network status).
            Insets are handled internally so they cohabit with status bar. */}
        <ImpersonationBanner />
        <SocketStatusBanner />
        <RootNavigator />
      </View>
    </AppProviders>
  );
};

const appStyles = StyleSheet.create({
  container: { flex: 1 },
});
