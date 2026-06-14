// Manual jest mock for @sentry/react-native. Every API is a no-op so the
// observability reporter can call init/captureException/etc. without the native
// crash-reporting module. `wrap` returns the component unchanged so a
// Sentry-wrapped root still renders.
const noop = jest.fn();

module.exports = {
  init: noop,
  captureException: noop,
  captureMessage: noop,
  addBreadcrumb: noop,
  setUser: noop,
  setTag: noop,
  setContext: noop,
  setExtra: noop,
  withScope: jest.fn(cb => cb({ setTag: noop, setExtra: noop, setContext: noop })),
  wrap: jest.fn(component => component),
  flush: jest.fn(async () => true),
  close: jest.fn(async () => undefined),
  ReactNativeTracing: class ReactNativeTracing {},
  ReactNavigationInstrumentation: class ReactNavigationInstrumentation {},
  reactNavigationIntegration: jest.fn(() => ({ registerNavigationContainer: noop })),
  Severity: { Error: 'error', Warning: 'warning', Info: 'info' },
};
