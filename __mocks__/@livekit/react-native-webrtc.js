// Manual jest mock for @livekit/react-native-webrtc — pulled in transitively by
// @livekit/react-native. Stubbed to a no-op so requiring it never touches the
// native WebRTC module.
module.exports = {
  registerGlobals: jest.fn(),
  MediaStream: class MediaStream {},
  MediaStreamTrack: class MediaStreamTrack {},
  RTCPeerConnection: class RTCPeerConnection {},
};
