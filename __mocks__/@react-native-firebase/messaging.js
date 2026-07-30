// Manual Jest mock for the modular @react-native-firebase/messaging API.
// Each operation remains independently spyable while receiving the same
// Messaging instance as its first argument, matching the production contract.
const instance = {};
const AuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
};

module.exports = {
  AuthorizationStatus,
  getMessaging: jest.fn(() => instance),
  getToken: jest.fn(async () => 'test-fcm-token'),
  deleteToken: jest.fn(async () => undefined),
  requestPermission: jest.fn(async () => AuthorizationStatus.AUTHORIZED),
  onMessage: jest.fn(() => jest.fn()),
  onTokenRefresh: jest.fn(() => jest.fn()),
  getInitialNotification: jest.fn(async () => null),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  setBackgroundMessageHandler: jest.fn(),
  registerDeviceForRemoteMessages: jest.fn(async () => undefined),
};
