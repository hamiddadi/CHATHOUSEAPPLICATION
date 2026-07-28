// Manual jest mock for @notifee/react-native (auto-used for the node_modules
// package). Mirrors the small surface the app uses (channel + display).
const AndroidImportance = { NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4 };
const EventType = {
  UNKNOWN: -1,
  DISMISSED: 0,
  PRESS: 1,
  ACTION_PRESS: 2,
  DELIVERED: 3,
};

const notifee = {
  createChannel: jest.fn(async () => 'default'),
  displayNotification: jest.fn(async () => undefined),
  getInitialNotification: jest.fn(async () => null),
  onBackgroundEvent: jest.fn(),
  onForegroundEvent: jest.fn(() => jest.fn()),
};

module.exports = notifee;
module.exports.default = notifee;
module.exports.AndroidImportance = AndroidImportance;
module.exports.EventType = EventType;
