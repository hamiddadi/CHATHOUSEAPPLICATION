/**
 * renderScreen — shared harness for screen render tests. Wraps a screen element
 * in the minimum provider tree it needs to mount under jest (a fresh
 * QueryClient with retries disabled + a SafeAreaProvider) and wires the
 * per-test navigation spy + route into the mocked `@react-navigation/native`
 * (see jest-setup.ts). Returns @testing-library's render result plus the
 * `navigation` spy so tests can assert `navigation.navigate` was called.
 *
 * It deliberately does NOT mount a real NavigationContainer: screens only call
 * `useNavigation()` / `useRoute()`, and the partial mock satisfies both with
 * far less setup (no navigator config, no per-screen param-list typing).
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render, type RenderResult } from '@testing-library/react-native';
import { useAuthStore } from '../features/auth/store/authStore';
import type { AuthUser } from '../features/auth/types/auth.types';
import {
  makeNavigationSpy,
  setNavState,
  type NavigationSpy,
  type RouteState,
} from './navigationMock';

export interface RenderScreenOptions {
  /** Route params + optional name surfaced via `useRoute()`. */
  route?: { name?: string; params?: Record<string, unknown> };
  /** Provide a pre-built navigation spy (defaults to a fresh one). */
  navigation?: NavigationSpy;
  /** Seed the query cache before the screen mounts (e.g. prime a useQuery). */
  seedQueryData?: Array<{ key: unknown[]; data: unknown }>;
}

export interface RenderScreenResult extends RenderResult {
  navigation: NavigationSpy;
  queryClient: QueryClient;
}

/** A QueryClient tuned for tests: never retry, no caching surprises. */
const makeTestQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

/**
 * Render a screen inside the test provider tree.
 *
 * @example
 *   const { navigation, getByText } = renderScreen(<SettingsScreen />);
 *   fireEvent.press(getByText('Edit profile'));
 *   expect(navigation.navigate).toHaveBeenCalledWith('EditProfile');
 */
export const renderScreen = (
  ui: React.ReactElement,
  options: RenderScreenOptions = {},
): RenderScreenResult => {
  const navigation = options.navigation ?? makeNavigationSpy();
  const route: RouteState = {
    key: 'test-route',
    name: options.route?.name ?? 'Test',
    params: options.route?.params ?? {},
  };
  setNavState(navigation, route);

  const queryClient = makeTestQueryClient();
  for (const seed of options.seedQueryData ?? []) {
    queryClient.setQueryData(seed.key, seed.data);
  }

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>{children}</SafeAreaProvider>
    </QueryClientProvider>
  );

  const result = render(ui, { wrapper: Wrapper });
  return { ...result, navigation, queryClient };
};

/** A deterministic fake user for screens that read the auth store. */
export const fakeAuthUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 'user-test-1',
  username: 'tester',
  displayName: 'Test User',
  phoneNumber: '+10000000000',
  avatarUrl: null,
  bio: null,
  interests: [],
  hasCompletedOnboarding: true,
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

/**
 * Force the Zustand auth store into an authenticated state with a fake user.
 * Call inside a test (or beforeEach) for screens that gate on auth. Returns the
 * user it set so the test can assert against ids.
 */
export const mockAuthenticated = (overrides: Partial<AuthUser> = {}): AuthUser => {
  const user = fakeAuthUser(overrides);
  useAuthStore.setState({
    status: 'authenticated',
    isHydrating: false,
    user,
    session: {
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    error: null,
  });
  return user;
};

/** Reset the auth store to a clean unauthenticated state (use in afterEach). */
export const resetAuth = (): void => {
  useAuthStore.setState({
    status: 'unauthenticated',
    isHydrating: false,
    user: null,
    session: null,
    error: null,
  });
};
