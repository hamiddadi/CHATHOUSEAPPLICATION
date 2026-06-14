// Manual jest mock for @react-native-community/geolocation. getCurrentPosition
// invokes the success callback with a fixed Paris coordinate so location-aware
// screens render a deterministic position without the native GPS module.
const POSITION = {
  coords: {
    latitude: 48.8566,
    longitude: 2.3522,
    accuracy: 5,
    altitude: null,
    heading: null,
    speed: null,
    altitudeAccuracy: null,
  },
  timestamp: 0,
};

module.exports = {
  default: {
    getCurrentPosition: jest.fn(success => success(POSITION)),
    watchPosition: jest.fn(() => 0),
    clearWatch: jest.fn(),
    stopObserving: jest.fn(),
    requestAuthorization: jest.fn(),
    setRNConfiguration: jest.fn(),
  },
  getCurrentPosition: jest.fn(success => success(POSITION)),
  watchPosition: jest.fn(() => 0),
  clearWatch: jest.fn(),
  stopObserving: jest.fn(),
  requestAuthorization: jest.fn(),
  setRNConfiguration: jest.fn(),
};
