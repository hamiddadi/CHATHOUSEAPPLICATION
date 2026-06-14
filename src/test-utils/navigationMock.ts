/**
 * Mutable holder backing the partial mock of `@react-navigation/native`
 * (installed in jest-setup.ts). `renderScreen()` writes the per-test navigation
 * spy + route here BEFORE rendering; the mocked `useNavigation()` / `useRoute()`
 * read from it. Kept in its own module so jest-setup can require it without a
 * circular dependency on renderScreen.tsx.
 */

export interface NavigationSpy {
  navigate: jest.Mock;
  push: jest.Mock;
  goBack: jest.Mock;
  replace: jest.Mock;
  popToTop: jest.Mock;
  setParams: jest.Mock;
  setOptions: jest.Mock;
  dispatch: jest.Mock;
  reset: jest.Mock;
  addListener: jest.Mock;
  removeListener: jest.Mock;
  isFocused: jest.Mock;
  canGoBack: jest.Mock;
  getParent: jest.Mock;
  getState: jest.Mock;
}

export interface RouteState {
  key: string;
  name: string;
  params: Record<string, unknown>;
}

/** Build a fresh set of jest.fn navigation spies. */
export const makeNavigationSpy = (): NavigationSpy => ({
  navigate: jest.fn(),
  push: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  popToTop: jest.fn(),
  setParams: jest.fn(),
  setOptions: jest.fn(),
  dispatch: jest.fn(),
  reset: jest.fn(),
  // Listeners return an unsubscribe fn — screens call this in effect cleanup.
  addListener: jest.fn(() => () => undefined),
  removeListener: jest.fn(),
  isFocused: jest.fn(() => true),
  canGoBack: jest.fn(() => true),
  getParent: jest.fn(() => undefined),
  getState: jest.fn(() => ({ routes: [], index: 0 })),
});

interface Holder {
  navigation: NavigationSpy;
  route: RouteState;
}

// Seeded with sane defaults so a bare `useNavigation()` / `useRoute()` outside
// renderScreen still returns something usable.
export const navHolder: Holder = {
  navigation: makeNavigationSpy(),
  route: { key: 'test', name: 'Test', params: {} },
};

/** Replace the active navigation spy + route (called by renderScreen). */
export const setNavState = (navigation: NavigationSpy, route: RouteState): void => {
  navHolder.navigation = navigation;
  navHolder.route = route;
};
