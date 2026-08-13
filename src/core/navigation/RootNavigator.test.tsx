/**
 * RootNavigator — audit QA 2026-07-02 (AUTH / kill app post-OTP, Majeur):
 * an 'authenticated' user whose username is empty (app killed between OTP
 * verification and picking a handle) must be routed back to the Auth stack,
 * opened directly on the Username step — NOT to Onboarding/Main, which used
 * to skip the handle step forever.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { mockAuthenticated, resetAuth } from '../../test-utils/renderScreen';
import { RootNavigator } from './RootNavigator';

// Captures the props RootNavigator passes to NavigationContainer (notably
// `initialState`) while rendering children directly, so no real navigation
// runtime is stood up. `mock` prefix → allowed in hoisted jest.mock factories.
const mockContainerProps: Array<Record<string, unknown>> = [];

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: (props: { children?: React.ReactNode }) => {
      mockContainerProps.push(props as Record<string, unknown>);
      return props.children ?? null;
    },
  };
});

jest.mock('@react-navigation/native-stack', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  return {
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: { children?: React.ReactNode }) =>
        ReactActual.createElement(ReactActual.Fragment, null, children),
      Screen: ({ component: Component }: { component: React.ComponentType }) =>
        ReactActual.createElement(Component),
    }),
  };
});

jest.mock('./AuthNavigator', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  const { Text } = jest.requireActual('react-native');
  return { AuthNavigator: () => ReactActual.createElement(Text, null, 'AUTH_STACK') };
});

jest.mock('./MainNavigator', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  const { Text } = jest.requireActual('react-native');
  return { MainNavigator: () => ReactActual.createElement(Text, null, 'MAIN_STACK') };
});

jest.mock('./OnboardingNavigator', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  const { Text } = jest.requireActual('react-native');
  return { OnboardingNavigator: () => ReactActual.createElement(Text, null, 'ONBOARDING_STACK') };
});

// The account-restoration gate makes an authenticated /users/me call on mount;
// stub it to a no-op so these routing tests stay isolated from the network.
jest.mock('../../features/privacy', () => ({
  AccountRestorationGate: () => null,
  LegalAcceptanceGate: () => null,
}));

const usernameInitialState = {
  routes: [{ name: 'Auth', state: { routes: [{ name: 'Username' }] } }],
};

describe('RootNavigator', () => {
  beforeEach(() => {
    mockContainerProps.length = 0;
  });

  afterEach(() => {
    resetAuth();
  });

  it('routes an authenticated user without handle to the Auth stack opened on Username', () => {
    mockAuthenticated({ username: '' });
    const { getByText, queryByText } = render(<RootNavigator />);

    expect(getByText('AUTH_STACK')).toBeTruthy();
    expect(queryByText('MAIN_STACK')).toBeNull();
    expect(queryByText('ONBOARDING_STACK')).toBeNull();
    expect(mockContainerProps[0]?.initialState).toEqual(usernameInitialState);
  });

  it('prefers the Username gate over onboarding for a handle-less new user', () => {
    // Exact audit scenario: kill app between OTP verify and handle pick —
    // hasCompletedOnboarding is false too, but Username must come first.
    mockAuthenticated({ username: '', hasCompletedOnboarding: false });
    const { getByText, queryByText } = render(<RootNavigator />);

    expect(getByText('AUTH_STACK')).toBeTruthy();
    expect(queryByText('ONBOARDING_STACK')).toBeNull();
    expect(mockContainerProps[0]?.initialState).toEqual(usernameInitialState);
  });

  it('routes an onboarded user with a handle to Main without forcing an initial state', () => {
    mockAuthenticated();
    const { getByText } = render(<RootNavigator />);

    expect(getByText('MAIN_STACK')).toBeTruthy();
    expect(mockContainerProps[0]?.initialState).toBeUndefined();
  });

  it('still routes a handled, non-onboarded user to Onboarding', () => {
    mockAuthenticated({ hasCompletedOnboarding: false });
    const { getByText } = render(<RootNavigator />);

    expect(getByText('ONBOARDING_STACK')).toBeTruthy();
    expect(mockContainerProps[0]?.initialState).toBeUndefined();
  });

  it('routes an unauthenticated user to the Auth stack without forcing an initial state', () => {
    resetAuth();
    const { getByText } = render(<RootNavigator />);

    expect(getByText('AUTH_STACK')).toBeTruthy();
    expect(mockContainerProps[0]?.initialState).toBeUndefined();
  });
});
