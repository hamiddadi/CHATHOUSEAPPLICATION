// Manual jest mock for @react-native-firebase/messaging (auto-used for the
// node_modules package). The default export is a callable that returns the
// messaging instance; AuthorizationStatus is exposed as a static.
const instance = {
  getToken: jest.fn(async () => 'test-fcm-token'),
  requestPermission: jest.fn(async () => 1),
  onMessage: jest.fn(() => jest.fn()),
  onTokenRefresh: jest.fn(() => jest.fn()),
  setBackgroundMessageHandler: jest.fn(),
  registerDeviceForRemoteMessages: jest.fn(async () => undefined),
};

const messaging = () => instance;
messaging.AuthorizationStatus = { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 };

module.exports = messaging;
module.exports.default = messaging;
