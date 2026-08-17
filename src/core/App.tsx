import '../../global.css';
import './i18n'; // Side-effect init — must run before any component mounts.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppFonts } from '../shared/hooks/useAppFonts';
import { probeBackendHealth } from '../shared/services/api/healthProbe';
import { startNetworkListener, useNetworkStore } from '../shared/services/network/networkStore';
import { ImpersonationBanner } from '../features/admin/components/ImpersonationBanner';
import { useImpersonationStore } from '../features/admin/store/impersonationStore';
import { SocketStatusBanner } from '../features/rooms/components/SocketStatusBanner';
import { useSocketStore } from '../shared/services/realtime/socketStore';
import { OfflineBanner } from '../shared/components/OfflineBanner';
import { ToastPortal } from '../shared/components/Toast';
import { useAnalyticsConsentStore } from '../features/privacy';
import { setupForegroundPush } from '../features/notifications/services/pushNotifications';
import { reportException } from './observability/reporter';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';

// Boot-time NetInfo subscription. No-op if @react-native-community/netinfo
// isn't installed; the OfflineBanner simply never shows.
startNetworkListener();

/**
 * Keeps persistent status banners in normal document flow, then anchors
 * transient toasts inside the remaining navigator viewport. This prevents
 * offline, socket and impersonation messages from painting on top of one
 * another while retaining the system safe-area exactly once.
 */
const AppShell: React.FC = () => {
  const impersonationToken = useImpersonationStore(s => s.token);
  const impersonatedUser = useImpersonationStore(s => s.user);
  const impersonationExpiry = useImpersonationStore(s => s.expiresAt);
  const socketStatus = useSocketStore(s => s.status);
  const isOnline = useNetworkStore(s => s.isOnline);

  const impersonationVisible = Boolean(
    impersonationToken &&
    impersonatedUser &&
    impersonationExpiry &&
    impersonationExpiry > Date.now(),
  );
  const socketBannerVisible = socketStatus === 'reconnecting' || socketStatus === 'disconnected';
  const offlineVisible = !isOnline;
  const hasStatusBanner = impersonationVisible || socketBannerVisible || offlineVisible;

  return (
    <View style={appStyles.container}>
      <ImpersonationBanner />
      <SocketStatusBanner includeSafeArea={!impersonationVisible} />
      <OfflineBanner inline includeSafeArea={!impersonationVisible && !socketBannerVisible} />

      <View style={appStyles.container}>
        <RootNavigator />
        <ToastPortal topInset={hasStatusBanner ? 0 : undefined} />
      </View>
    </View>
  );
};

// Hydrate the GDPR analytics-consent store. Default = disabled, so until
// the user opts in (Settings → Confidentialité → toggle), the reporter is
// silent. Resolves quickly from the local consent preference.
// Capture a failed AsyncStorage read so it never becomes an unhandled
// rejection. The reporter remains a consent-gated no-op in production here.
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
      <AppShell />
    </AppProviders>
  );
};

const appStyles = StyleSheet.create({
  container: { flex: 1 },
});
