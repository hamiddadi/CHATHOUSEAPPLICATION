// Manual jest mock for @react-native-community/netinfo. Reports a connected
// state and a no-op subscription so the offline banner / network store treat
// the device as online under jest.
const STATE = {
  type: 'wifi',
  isConnected: true,
  isInternetReachable: true,
  details: {},
};

module.exports = {
  default: {
    fetch: jest.fn(async () => STATE),
    addEventListener: jest.fn(() => () => undefined),
    configure: jest.fn(),
    useNetInfo: jest.fn(() => STATE),
  },
  fetch: jest.fn(async () => STATE),
  addEventListener: jest.fn(() => () => undefined),
  configure: jest.fn(),
  useNetInfo: jest.fn(() => STATE),
};
