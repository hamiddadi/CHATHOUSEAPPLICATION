// Manual jest mock for react-native-keychain. Backs the auth token storage in
// tests with an in-memory map so set/get round-trips work without the native
// secure store.
let store = {};

module.exports = {
  setGenericPassword: jest.fn(async (username, password, options) => {
    const service = (options && options.service) || 'default';
    store[service] = { username, password };
    return true;
  }),
  getGenericPassword: jest.fn(async options => {
    const service = (options && options.service) || 'default';
    return store[service] ?? false;
  }),
  resetGenericPassword: jest.fn(async options => {
    const service = (options && options.service) || 'default';
    delete store[service];
    return true;
  }),
  __reset: () => {
    store = {};
  },
  ACCESSIBLE: { WHEN_UNLOCKED: 'AccessibleWhenUnlocked' },
  ACCESS_CONTROL: {},
  AUTHENTICATION_TYPE: {},
  SECURITY_LEVEL: {},
  STORAGE_TYPE: {},
};
