// Manual jest mock for @livekit/react-native. The audio engine is a no-op under
// jest — LiveKitEngine wraps every call and the screen falls back to its
// non-live audio banner. We provide a Room class + the RoomEvent/ConnectionState
// enums + registerGlobals so LiveKitEngine.ensureSdk() succeeds without the
// native WebRTC layer.
class Room {
  constructor() {
    this.localParticipant = { setMicrophoneEnabled: jest.fn(async () => undefined) };
    this.remoteParticipants = new Map();
    this.state = 'disconnected';
    this.activeSpeakers = [];
  }
  connect = jest.fn(async () => undefined);
  disconnect = jest.fn(() => undefined);
  on() {
    return this;
  }
  off() {
    return this;
  }
}

const RoomEvent = {
  Connected: 'connected',
  Disconnected: 'disconnected',
  Reconnecting: 'reconnecting',
  Reconnected: 'reconnected',
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  ActiveSpeakersChanged: 'activeSpeakersChanged',
  TrackMuted: 'trackMuted',
  TrackUnmuted: 'trackUnmuted',
  ConnectionStateChanged: 'connectionStateChanged',
  SignalReconnecting: 'signalReconnecting',
  MediaDevicesError: 'mediaDevicesError',
};

const ConnectionState = {
  Disconnected: 'disconnected',
  Connected: 'connected',
  Reconnecting: 'reconnecting',
};

module.exports = {
  Room,
  RoomEvent,
  ConnectionState,
  registerGlobals: jest.fn(),
  AudioSession: {
    startAudioSession: jest.fn(async () => undefined),
    stopAudioSession: jest.fn(async () => undefined),
    configureAudio: jest.fn(async () => undefined),
  },
  AndroidAudioTypePresets: {
    communication: {},
    media: {},
  },
};
