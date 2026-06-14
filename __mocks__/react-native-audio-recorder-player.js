// Manual jest mock for react-native-audio-recorder-player. The default export is
// a class with the record/play methods the voice features call; all resolve to
// sane no-op values so screens depending on a player instance mount cleanly.
class AudioRecorderPlayer {
  startRecorder = jest.fn(async () => 'file:///mock-recording.mp4');
  stopRecorder = jest.fn(async () => 'file:///mock-recording.mp4');
  pauseRecorder = jest.fn(async () => 'paused');
  resumeRecorder = jest.fn(async () => 'resumed');
  startPlayer = jest.fn(async () => 'file:///mock-playback.mp4');
  stopPlayer = jest.fn(async () => 'stopped');
  pausePlayer = jest.fn(async () => 'paused');
  resumePlayer = jest.fn(async () => 'resumed');
  seekToPlayer = jest.fn(async () => 0);
  setVolume = jest.fn(async () => 1);
  setSubscriptionDuration = jest.fn(() => undefined);
  addRecordBackListener = jest.fn(() => undefined);
  removeRecordBackListener = jest.fn(() => undefined);
  addPlayBackListener = jest.fn(() => undefined);
  removePlayBackListener = jest.fn(() => undefined);
  mmssss = jest.fn(() => '00:00:00');
  mmss = jest.fn(() => '00:00');
}

module.exports = AudioRecorderPlayer;
module.exports.default = AudioRecorderPlayer;
// Enums the library exports alongside the default class.
module.exports.AudioEncoderAndroidType = { AAC: 3 };
module.exports.AudioSourceAndroidType = { MIC: 1 };
module.exports.AVEncoderAudioQualityIOSType = { high: 96 };
module.exports.AVEncodingOption = { aac: 'aac' };
module.exports.OutputFormatAndroidType = { MPEG_4: 2 };
