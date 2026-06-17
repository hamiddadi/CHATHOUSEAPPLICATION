// Manual mock for @react-native-voice/voice (native speech recogniser).
// Auto-applied for any import of the package under jest (no native module in
// the test runtime). The on-device caption publisher stays inert in tests.
const Voice = {
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  cancel: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(() => Promise.resolve()),
  removeAllListeners: jest.fn(),
  isAvailable: jest.fn(() => Promise.resolve(1)),
  isRecognizing: jest.fn(() => Promise.resolve(0)),
  getSpeechRecognitionServices: jest.fn(() => Promise.resolve([])),
  onSpeechStart: null,
  onSpeechRecognized: null,
  onSpeechEnd: null,
  onSpeechError: null,
  onSpeechResults: null,
  onSpeechPartialResults: null,
  onSpeechVolumeChanged: null,
};

module.exports = { __esModule: true, default: Voice };
