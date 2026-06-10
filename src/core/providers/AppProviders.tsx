import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '../../shared/components/ErrorBoundary';
import { ToastPortal } from '../../shared/components/Toast';
import { OfflineBanner } from '../../shared/components/OfflineBanner';
import { reportException } from '../observability/reporter';
import { ExtensionsProvider } from '../../features/extensions';
import { useAuthStore } from '../../features/auth/store/authStore';
import { ThemeProvider } from './ThemeProvider';
import { QueryProvider } from './QueryProvider';
import { AuthProvider } from './AuthProvider';

/**
 * Inner gate that reads auth status and forwards it to ExtensionsProvider.
 * Lives inside AuthProvider so the Zustand store is already hydrated.
 */
const ExtensionsProviderGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const status = useAuthStore(s => s.status);
  return (
    <ExtensionsProvider authenticated={status === 'authenticated'}>{children}</ExtensionsProvider>
  );
};

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const handleBoundaryError = useCallback((error: Error, info: React.ErrorInfo) => {
    reportException(error, { componentStack: info.componentStack });
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary onError={handleBoundaryError}>
        <SafeAreaProvider>
          <ThemeProvider>
            <QueryProvider>
              <AuthProvider>
                <ExtensionsProviderGate>{children}</ExtensionsProviderGate>
              </AuthProvider>
            </QueryProvider>
          </ThemeProvider>
          {/* Global overlays rendered last so they z-index above app content.
              OfflineBanner stays at the top of the screen while disconnected;
              ToastPortal stacks transient messages just below it. */}
          <OfflineBanner />
          <ToastPortal />
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({ root: { flex: 1 } });
