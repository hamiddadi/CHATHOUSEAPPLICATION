/**
 * Shared render harness for screen-level tests.
 *
 * Wraps a screen in the providers it needs to mount in isolation under jest:
 *   - QueryClientProvider (a fresh, retry-disabled client per render)
 *   - SafeAreaProvider with deterministic insets (so useSafeAreaInsets works)
 *   - real i18n (so t('...') returns real EN strings you can assert on)
 *
 * Navigation hooks are mocked globally in jest-setup.ts. `renderScreen` wires a
 * fresh navigation spy and the requested route params into those mocks for each
 * render and returns the navigation object so tests can assert on .navigate().
 *
 * Usage:
 *   const { navigation } = renderScreen(<RoomFeedScreen />);
 *   fireEvent.press(screen.getByLabelText('Join room: ...'));
 *   expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: '1' });
 *
 * Feature data is NOT provided here — mock the screen's service hooks per-test
 * (e.g. jest.mock('../../hooks/useRooms')) so each test controls its own state.
 */
import React, { type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { render, type RenderOptions } from '@testing-library/react-native';

// Side-effect import: initialises i18next so useTranslation() returns strings.
import '../core/i18n';

const INITIAL_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface MockNavigation {
  navigate: jest.Mock;
  goBack: jest.Mock;
  push: jest.Mock;
  pop: jest.Mock;
  replace: jest.Mock;
  reset: jest.Mock;
  setOptions: jest.Mock;
  setParams: jest.Mock;
  dispatch: jest.Mock;
  addListener: jest.Mock;
  removeListener: jest.Mock;
  canGoBack: jest.Mock;
  isFocused: jest.Mock;
  getParent: jest.Mock;
  getState: jest.Mock;
}

const makeNavigation = (overrides: Partial<MockNavigation> = {}): MockNavigation => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  push: jest.fn(),
  pop: jest.fn(),
  replace: jest.fn(),
  reset: jest.fn(),
  setOptions: jest.fn(),
  setParams: jest.fn(),
  dispatch: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  canGoBack: jest.fn(() => true),
  isFocused: jest.fn(() => true),
  getParent: jest.fn(),
  getState: jest.fn(() => ({ routes: [], index: 0 })),
  ...overrides,
});

const makeQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
    // Swallow query errors in tests; assertions target the rendered error UI.
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  } as ConstructorParameters<typeof QueryClient>[0]);

export interface RenderScreenOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Params returned by useRoute().params inside the screen. */
  routeParams?: Record<string, unknown>;
  /** Route name returned by useRoute().name. */
  routeName?: string;
  /** Override individual navigation methods (e.g. spy implementations). */
  navigation?: Partial<MockNavigation>;
  /** Provide a pre-seeded QueryClient instead of a fresh one. */
  queryClient?: QueryClient;
}

export interface RenderScreenResult extends ReturnType<typeof render> {
  navigation: MockNavigation;
  queryClient: QueryClient;
}

/**
 * Render a screen with all providers + navigation mocks wired up.
 */
export const renderScreen = (
  ui: ReactElement,
  options: RenderScreenOptions = {},
): RenderScreenResult => {
  const {
    routeParams = {},
    routeName = 'Test',
    navigation: navOverrides,
    queryClient: qc,
    ...rest
  } = options;

  const navigation = makeNavigation(navOverrides);
  const queryClient = qc ?? makeQueryClient();

  // Point the globally-mocked hooks at this render's instances.
  (useNavigation as unknown as jest.Mock).mockReturnValue(navigation);
  (useRoute as unknown as jest.Mock).mockReturnValue({
    key: `${routeName}-route`,
    name: routeName,
    params: routeParams,
  });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={INITIAL_METRICS}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );

  const result = render(ui, { wrapper: Wrapper, ...rest });
  return { ...result, navigation, queryClient };
};

// Re-export the testing-library surface so screen tests import everything from
// one place: `import { renderScreen, fireEvent, screen, waitFor } from '@/test-utils/renderScreen';`
export * from '@testing-library/react-native';
