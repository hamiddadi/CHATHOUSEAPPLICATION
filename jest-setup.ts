/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock() factories and side-effect setup files (gesture-handler) require require(); import is not allowed there. */
/* eslint-disable @typescript-eslint/no-explicit-any -- the axios test double mirrors axios's loosely-typed surface (create/instance/isAxiosError); `any` is intentional in this infra file. */
/**
 * Global jest setup (setupFilesAfterEnv). Runs once per test file, after the
 * jest-expo preset. Its job is to neutralise the native-only modules that can't
 * run under Node so that *screen* components can be rendered and asserted in
 * isolation. Anything feature-specific (service hooks, store state) is mocked
 * per-test, not here.
 */
// Note: @testing-library/react-native v13 auto-extends jest's `expect` with its
// matchers (toBeOnTheScreen, toHaveTextContent, …) on first import — no separate
// extend-expect entry point exists.

// --- Reanimated -----------------------------------------------------------
// Use our self-contained mock (the package's own /mock re-imports real
// reanimated → react-native-worklets native init → throws under jest). The
// factory just requires the manual mock so nativewind's babel transform never
// touches this hoisted factory, and the relative path resolves from this file
// regardless of jest `roots`.
jest.mock('react-native-reanimated', () => require('./__mocks__/react-native-reanimated'));

// Silence the useNativeDriver warning emitted by the RN Animated shim.
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper', () => ({}), { virtual: true });

// --- Gesture handler ------------------------------------------------------
require('react-native-gesture-handler/jestSetup');

// --- React Navigation -----------------------------------------------------
// Screens call useNavigation()/useRoute() without a real NavigationContainer
// in unit tests. We replace the hooks with configurable jest.fn()s (driven by
// the renderScreen helper) and keep everything else (CommonActions, etc.) real.
// useFocusEffect is reimplemented as a one-shot effect so focus-driven data
// loads still fire on mount.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const React = require('react');
  return {
    ...actual,
    useNavigation: jest.fn(() => ({
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
    })),
    useRoute: jest.fn(() => ({ key: 'test-route', name: 'Test', params: {} })),
    useIsFocused: jest.fn(() => true),
    useFocusEffect: jest.fn((cb: () => void | (() => void)) => {
      React.useEffect(() => {
        const cleanup = cb();
        return cleanup;
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
    }),
    useScrollToTop: jest.fn(),
  };
});

// --- Component-rendering native modules -----------------------------------
// These render JSX, so their mocks live in standalone __mocks__/*.js modules: an
// inline jest.mock factory using createElement would be hoisted ABOVE
// nativewind's injected babel helper and crash ("_ReactNativeCSSInterop is not
// defined"). The factory-require keeps the createElement in a separate module
// AND resolves the path from this file regardless of jest `roots` (which is
// scoped to src/, so root-level __mocks__ are not auto-discovered).
jest.mock('react-native-maps', () => require('./__mocks__/react-native-maps'));
jest.mock('expo-image', () => require('./__mocks__/expo-image'));
jest.mock('expo-blur', () => require('./__mocks__/expo-blur'));
jest.mock('expo-linear-gradient', () => require('./__mocks__/expo-linear-gradient'));
jest.mock('expo-camera', () => require('./__mocks__/expo-camera'));

// --- LiveKit / WebRTC -----------------------------------------------------
jest.mock('@livekit/react-native', () => ({
  __esModule: true,
  registerGlobals: jest.fn(),
  AudioSession: {
    startAudioSession: jest.fn().mockResolvedValue(undefined),
    stopAudioSession: jest.fn().mockResolvedValue(undefined),
    configureAudio: jest.fn().mockResolvedValue(undefined),
  },
  useRoom: jest.fn(),
  useParticipant: jest.fn(),
  LiveKitRoom: ({ children }: any) => children ?? null,
}));
jest.mock('@livekit/react-native-webrtc', () => ({}), { virtual: true });
jest.mock('livekit-client', () => ({ Room: jest.fn(), RoomEvent: {}, Track: {} }), {
  virtual: true,
});

// --- axios ----------------------------------------------------------------
// apiClient.ts does `axios.create(...)` at import time, and axios's fetch
// adapter eagerly probes ReadableStream on load, which crashes under jest-expo's
// stream polyfill ("Cannot cancel a stream that already has a reader"). Any
// screen that transitively imports apiClient hits this. Mock axios so importing
// the client is inert; service hooks are mocked per-test, so no real HTTP is
// needed.
jest.mock('axios', () => {
  const makeInstance = () => {
    const instance: any = jest.fn(() => Promise.resolve({ data: {} }));
    instance.interceptors = {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    };
    instance.defaults = { headers: { common: {} } };
    ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'].forEach(m => {
      instance[m] = jest.fn(() => Promise.resolve({ data: {} }));
    });
    instance.create = makeInstance;
    return instance;
  };
  const axios = makeInstance();
  axios.isAxiosError = (e: any) => Boolean(e && e.isAxiosError);
  axios.isCancel = () => false;
  axios.CancelToken = { source: () => ({ token: {}, cancel: jest.fn() }) };
  axios.all = (ps: unknown[]) => Promise.all(ps);
  axios.spread = (cb: (...a: unknown[]) => unknown) => (arr: unknown[]) => cb(...arr);
  return { __esModule: true, default: axios, isAxiosError: axios.isAxiosError };
});

// --- socket.io-client -----------------------------------------------------
// Return a fully no-op socket so socketClient.getSocket() never opens a real
// connection during tests.
jest.mock('socket.io-client', () => {
  const noopSocket = {
    on: jest.fn().mockReturnThis(),
    off: jest.fn().mockReturnThis(),
    once: jest.fn().mockReturnThis(),
    emit: jest.fn().mockReturnThis(),
    connect: jest.fn().mockReturnThis(),
    disconnect: jest.fn().mockReturnThis(),
    removeAllListeners: jest.fn().mockReturnThis(),
    timeout: jest.fn().mockReturnThis(),
    connected: false,
    io: { on: jest.fn(), off: jest.fn(), removeAllListeners: jest.fn() },
  };
  return { __esModule: true, io: jest.fn(() => noopSocket), Manager: jest.fn(), Socket: jest.fn() };
});

// --- Expo native modules not auto-mocked by jest-expo ---------------------
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
  getStringAsync: jest.fn().mockResolvedValue(''),
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US', regionCode: 'US' }],
  getCalendars: () => [{ timeZone: 'UTC' }],
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: null }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true, assets: null }),
  requestMediaLibraryPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: 'granted', granted: true }),
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos', All: 'All' },
  MediaType: { Images: 'images', Videos: 'videos' },
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: 'granted', granted: true }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 0, longitude: 0 } }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  Accuracy: { Balanced: 3, High: 4, Highest: 6 },
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
}));

// --- AsyncStorage ---------------------------------------------------------
// Common transitive dep; ships an official jest mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// --- expo-audio -----------------------------------------------------------
// Used by room replays / voice-message screens. Data-only mock (no native).
jest.mock('expo-audio', () => ({
  __esModule: true,
  useAudioPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
    replace: jest.fn(),
    playing: false,
    paused: true,
    currentTime: 0,
    duration: 0,
    muted: false,
    volume: 1,
  }),
  useAudioPlayerStatus: () => ({
    playing: false,
    currentTime: 0,
    duration: 0,
    didJustFinish: false,
  }),
  useAudioRecorder: () => ({
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn(() => ({ isRecording: false })),
    uri: null,
  }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
  createAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn(), remove: jest.fn() })),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
  setIsAudioActiveAsync: jest.fn().mockResolvedValue(undefined),
  requestRecordingPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true, status: 'granted' }),
  getRecordingPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  AudioModule: { setAudioModeAsync: jest.fn().mockResolvedValue(undefined) },
  RecordingPresets: { HIGH_QUALITY: {}, LOW_QUALITY: {} },
}));

// --- NetInfo --------------------------------------------------------------
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
    configure: jest.fn(),
  },
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
}));

// --- Sentry ---------------------------------------------------------------
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  addBreadcrumb: jest.fn(),
  wrap: (c: unknown) => c,
  ReactNavigationInstrumentation: jest.fn(),
  reactNavigationIntegration: jest.fn(() => ({})),
}));

// Quieten noisy act()/animation warnings that don't affect assertions.
const originalError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const msg = String(args[0] ?? '');
    if (
      msg.includes('useNativeDriver') ||
      msg.includes('not wrapped in act') ||
      msg.includes('VirtualizedList')
    ) {
      return;
    }
    originalError(...(args as []));
  });
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore?.();
});
