/**
 * Global jest setup (setupFilesAfterEnv). Mocks every native module a screen
 * may pull in so it can MOUNT under jest without a native runtime, then boots
 * i18n so `useTranslation()` resolves real strings instead of bare keys.
 *
 * The stub bodies live in the root `__mocks__/` folder; this file registers
 * each one with an explicit `jest.mock(pkg, () => require('./__mocks__/...'))`.
 * (Jest does NOT reliably auto-apply node_modules manual mocks here — the RN
 * preset's transformIgnorePatterns let these packages through babel first, so
 * the real native module loads before the auto-mock can intercept. Explicit
 * registration is what makes the stub win.) Registered this way:
 *   @react-native-vector-icons/{material-icons,ionicons,fontawesome}
 *   react-native-svg, react-native-maps
 *   @livekit/react-native (+ -webrtc), react-native-audio-recorder-player
 *   react-native-keychain, react-native-image-picker, react-native-haptic-feedback
 *   @react-native-community/{geolocation,netinfo}, @react-native-clipboard/clipboard
 *   @sentry/react-native, @react-native-firebase/messaging, @notifee/react-native
 *
 * reanimated / safe-area-context / async-storage use a bundled-or-official mock;
 * '@env' is a virtual module; @react-navigation/native is partially mocked.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

// ── '@env' — virtual module inlined by react-native-dotenv at babel time.
// Under jest there's no .env-driven transform guarantee, so provide test
// values that satisfy src/config/env.ts's zod schema.
jest.mock(
  '@env',
  () => ({
    API_BASE_URL: 'http://localhost:4000/api',
    WS_BASE_URL: 'ws://localhost:4000',
    REALTIME_ENABLED: 'false',
    ENV: 'development',
    SENTRY_DSN: undefined,
    LIVEKIT_URL: 'ws://localhost:7880',
  }),
  { virtual: true },
);

// ── react-native-reanimated (v4) — hand-stubbed in __mocks__/. We point jest at
// it explicitly: the preset's transformIgnorePatterns let reanimated's real
// src/ through babel, and the worklets plugin pulls in the native worklets
// binding (which throws under jest) before the auto-mock can intercept. An
// explicit jest.mock guarantees our stub wins.
jest.mock('react-native-reanimated', () => require('./__mocks__/react-native-reanimated'));

// ── @react-native-async-storage/async-storage — official jest mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// ── Native modules whose stub lives in the root `__mocks__/` folder. Jest does
// not reliably auto-apply node_modules manual mocks when the package is reached
// through the preset's transform allow-list, so we register each one explicitly
// (no factory → Jest resolves the adjacent `__mocks__/<pkg>.js`). These calls
// are hoisted by babel-plugin-jest-hoist, so they must be literal, individual
// statements. (The .ttf font require in the vector-icons packages, react-native-
// svg/maps' native views, the LiveKit/WebRTC native bindings, the audio /
// keychain / geolocation / clipboard / haptics native modules, and Sentry's
// native bridge all throw or no-op under jest without these.)
jest.mock('@react-native-vector-icons/material-icons', () =>
  require('./__mocks__/@react-native-vector-icons/material-icons'),
);
jest.mock('@react-native-vector-icons/ionicons', () =>
  require('./__mocks__/@react-native-vector-icons/ionicons'),
);
jest.mock('@react-native-vector-icons/fontawesome', () =>
  require('./__mocks__/@react-native-vector-icons/fontawesome'),
);
jest.mock('react-native-svg', () => require('./__mocks__/react-native-svg'));
jest.mock('react-native-maps', () => require('./__mocks__/react-native-maps'));
jest.mock('@livekit/react-native', () => require('./__mocks__/@livekit/react-native'));
jest.mock('@livekit/react-native-webrtc', () =>
  require('./__mocks__/@livekit/react-native-webrtc'),
);
jest.mock('react-native-audio-recorder-player', () =>
  require('./__mocks__/react-native-audio-recorder-player'),
);
jest.mock('react-native-keychain', () => require('./__mocks__/react-native-keychain'));
jest.mock('react-native-image-picker', () => require('./__mocks__/react-native-image-picker'));
jest.mock('react-native-haptic-feedback', () =>
  require('./__mocks__/react-native-haptic-feedback'),
);
jest.mock('@react-native-community/geolocation', () =>
  require('./__mocks__/@react-native-community/geolocation'),
);
jest.mock('@react-native-community/netinfo', () =>
  require('./__mocks__/@react-native-community/netinfo'),
);
jest.mock('@react-native-clipboard/clipboard', () =>
  require('./__mocks__/@react-native-clipboard/clipboard'),
);
jest.mock('@sentry/react-native', () => require('./__mocks__/@sentry/react-native'));
// FCM + notifee — manual mocks already existed in __mocks__/ for these; register
// them explicitly so the native Firebase/notifee bridges never load under jest.
jest.mock('@react-native-firebase/messaging', () =>
  require('./__mocks__/@react-native-firebase/messaging'),
);
jest.mock('@notifee/react-native', () => require('./__mocks__/@notifee/react-native'));

// ── react-native-safe-area-context — official jest mock (provides default
// insets/frame + a simplified provider). Screens read insets via
// useSafeAreaInsets(), so this must be in place before any render.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// ── react-native-gesture-handler — its jestSetup wires the native shims and
// registers a State enum + gesture components used across the app.
require('react-native-gesture-handler/jestSetup');

// ── @react-navigation/native — partial mock. Keeps every real export
// (NavigationContainer, theming, types) but routes `useNavigation()` /
// `useRoute()` / `useNavigationState()` to the per-test holder that
// renderScreen() writes. Screens get spyable navigation + the route params the
// test supplies, without standing up a full navigator.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const { navHolder } = require('./src/test-utils/navigationMock');
  return {
    ...actual,
    useNavigation: () => navHolder.navigation,
    useRoute: () => navHolder.route,
    useNavigationState: (selector: (state: any) => any) =>
      selector(navHolder.navigation.getState()),
    useIsFocused: () => true,
    useFocusEffect: (cb: () => void | (() => void)) => {
      const React = require('react');
      // Run once on mount, like a focus event — `cb` intentionally omitted from
      // deps (mirrors RN's useFocusEffect, which keys on focus, not identity).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      React.useEffect(() => cb(), []);
    },
  };
});

// ── i18n boot — side-effect init so `useTranslation()` returns real strings.
// react-native-localize is already mapped to its mock in jest.config.js, so
// getLocales() resolves and i18next initialises synchronously.
require('./src/core/i18n');

// ── Silence the noisy, non-actionable RN/animation warnings that flood screen
// renders (act() advice, animated-helper deprecations). Real errors still log.
const SILENCED = [
  'useNativeDriver',
  'AnimatedComponent',
  'act(...)',
  'inside a test was not wrapped in act',
  'componentWillReceiveProps',
  'componentWillMount',
];
const originalError = console.error.bind(console);
const originalWarn = console.warn.bind(console);
const shouldSilence = (args: unknown[]): boolean => {
  const first = typeof args[0] === 'string' ? (args[0] as string) : '';
  return SILENCED.some(pattern => first.includes(pattern));
};
// eslint-disable-next-line no-console
console.error = (...args: unknown[]) => {
  if (shouldSilence(args)) return;
  originalError(...args);
};
// eslint-disable-next-line no-console
console.warn = (...args: unknown[]) => {
  if (shouldSilence(args)) return;
  originalWarn(...args);
};
