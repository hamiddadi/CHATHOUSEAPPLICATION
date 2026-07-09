/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
/**
 * LiveKitEngine — thin wrapper around `@livekit/react-native` that manages
 * LiveKit Room instances for the app. Lazy-loaded so the rest of the
 * codebase keeps booting in Expo Go (where the native module is
 * unavailable); the public functions early-return / throw a sentinel
 * when the SDK isn't present.
 *
 * Architecture choice — LiveKit replaces Agora as the audio engine.
 * Room presence + roles + chat + reactions still go through our HTTP +
 * Socket.IO layer (Participant model); LiveKit handles ONLY the audio bus.
 */

interface LiveKitSdk {
  Room: new () => LiveKitRoom;
  RoomEvent: {
    Connected: string;
    Disconnected: string;
    Reconnecting: string;
    Reconnected: string;
    ParticipantConnected: string;
    ParticipantDisconnected: string;
    ActiveSpeakersChanged: string;
    TrackMuted: string;
    TrackUnmuted: string;
    ConnectionStateChanged: string;
    SignalReconnecting: string;
    MediaDevicesError: string;
  };
  ConnectionState: {
    Disconnected: string;
    Connected: string;
    Reconnecting: string;
  };
  registerGlobals: () => void;
  // Native audio session manager. MUST be configured + started before
  // connecting a Room or Android won't route mic/speaker correctly (audio
  // focus, communication mode, Bluetooth). See AudioSession.d.ts.
  AudioSession: {
    configureAudio: (config: LiveKitAudioConfig) => Promise<void>;
    startAudioSession: () => Promise<void>;
    stopAudioSession: () => Promise<void>;
  };
  AndroidAudioTypePresets: { communication: unknown; media: unknown };
}

/** Minimal shape of `@livekit/react-native`'s AudioConfiguration we use. */
interface LiveKitAudioConfig {
  android?: {
    preferredOutputList?: ('speaker' | 'earpiece' | 'headset' | 'bluetooth')[];
    audioTypeOptions: unknown;
  };
  ios?: { defaultOutput?: 'speaker' | 'earpiece' };
}

export interface LiveKitRoom {
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => void;
  on: (event: string, handler: (...args: any[]) => void) => LiveKitRoom;
  off: (event: string, handler: (...args: any[]) => void) => LiveKitRoom;
  localParticipant: LiveKitLocalParticipant;
  remoteParticipants: Map<string, LiveKitRemoteParticipant>;
  state: string;
  activeSpeakers: LiveKitParticipant[];
}

export interface LiveKitParticipant {
  identity: string;
  sid: string;
  isSpeaking: boolean;
  audioLevel: number;
}

export interface LiveKitLocalParticipant extends LiveKitParticipant {
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
}

// Remote participants expose tracks but we only need identity + audio info,
// so this is a semantic alias of the base participant shape.
export type LiveKitRemoteParticipant = LiveKitParticipant;

export const LIVEKIT_UNAVAILABLE_SENTINEL = 'LiveKitEngine: @livekit/react-native not installed';

/**
 * Semantic projection of the LiveKit connection state, consumed by
 * `roomAudioService`. We map LiveKit's ConnectionState onto the three
 * states the rest of the app cares about:
 *   - `connected`     → ConnectionState.Connected: audio is flowing
 *   - `reconnecting`  → ConnectionState.Reconnecting: transient,
 *                       the SDK is auto-retrying — surface a banner only
 *   - `failed`        → ConnectionState.Disconnected (unexpected):
 *                       the SDK gave up; the service kicks a bounded rejoin
 */
export type LiveKitSemanticState = 'connected' | 'reconnecting' | 'failed';

/**
 * Map LiveKit's ConnectionState onto our 3-state semantic model.
 */
export const mapLiveKitConnectionState = (state: string): LiveKitSemanticState => {
  switch (state) {
    case 'connected':
      return 'connected';
    // livekit-client's ConnectionState has 5 values — 'connecting' and
    // 'signalReconnecting' are transient, not failures. Folding them into
    // 'reconnecting' avoids spurious rejoin storms if the real
    // connectionStateChanged event is ever wired through here.
    case 'connecting':
    case 'reconnecting':
    case 'signalReconnecting':
      return 'reconnecting';
    case 'disconnected':
    default:
      return 'failed';
  }
};

/**
 * Compose the LiveKit SDK surface from the TWO packages it actually lives in.
 *
 * `@livekit/react-native` does NOT re-export the core SDK classes `Room`,
 * `RoomEvent`, or `ConnectionState` — those live in `livekit-client` (which
 * @livekit/react-native pulls in as a peer dep and uses internally). Requiring
 * only @livekit/react-native left `s.Room` undefined, so `new s.Room()` threw
 * "Cannot read property 'prototype' of undefined" on every room entry. We
 * therefore source:
 *   - Room / RoomEvent / ConnectionState        ← livekit-client
 *   - registerGlobals / AudioSession /
 *     AndroidAudioTypePresets (native helpers)   ← @livekit/react-native
 */
const loadSdk = (): LiveKitSdk | null => {
  try {
    const rn = require('@livekit/react-native');
    const client = require('livekit-client');
    return {
      Room: client.Room,
      RoomEvent: client.RoomEvent,
      ConnectionState: client.ConnectionState,
      registerGlobals: rn.registerGlobals,
      AudioSession: rn.AudioSession,
      AndroidAudioTypePresets: rn.AndroidAudioTypePresets,
    } as LiveKitSdk;
  } catch {
    return null;
  }
};

let sdk: LiveKitSdk | null = null;
let globalsRegistered = false;

const ensureSdk = (): LiveKitSdk => {
  if (sdk) return sdk;
  const loaded = loadSdk();
  // Guard the whole SDK surface, not just module presence: if livekit-client
  // failed to compose (Room missing) treat it as unavailable (→ 'unsupported'
  // banner) rather than crashing later inside `new s.Room()`.
  if (!loaded || typeof loaded.Room !== 'function') {
    throw new Error(LIVEKIT_UNAVAILABLE_SENTINEL);
  }
  // Register globals BEFORE the first Room is constructed — livekit-client's
  // RN detection reads navigator.product + global.LiveKitReactNativeGlobal,
  // both set by @livekit/react-native's registerGlobals().
  if (!globalsRegistered) {
    try {
      loaded.registerGlobals();
    } catch {
      /* noop — may already be registered */
    }
    globalsRegistered = true;
  }
  sdk = loaded;
  return loaded;
};

/**
 * Create a new LiveKit Room instance. Unlike Agora's singleton engine,
 * LiveKit creates a new Room per session — the caller is responsible for
 * disconnecting it. This matches the React lifecycle better (one room per
 * mount of useRoomAudio).
 */
export const createLiveKitRoom = (): LiveKitRoom => {
  const s = ensureSdk();
  return new s.Room();
};

/**
 * Connect to a LiveKit room using a signed JWT token.
 */
export const connectLiveKitRoom = async (
  room: LiveKitRoom,
  url: string,
  token: string,
): Promise<void> => {
  await room.connect(url, token);
};

/**
 * Disconnect from the current LiveKit room.
 */
export const disconnectLiveKitRoom = (room: LiveKitRoom): void => {
  try {
    room.disconnect();
  } catch {
    /* noop */
  }
};

/**
 * Mute or unmute the local microphone.
 */
export const setLiveKitMuted = async (room: LiveKitRoom, muted: boolean): Promise<void> => {
  try {
    await room.localParticipant.setMicrophoneEnabled(!muted);
  } catch {
    /* noop — room may not be connected */
  }
};

/**
 * Get the LiveKit RoomEvent enum values.
 */
export const getLiveKitEvents = (): LiveKitSdk['RoomEvent'] => {
  const s = ensureSdk();
  return s.RoomEvent;
};

/**
 * Get the LiveKit ConnectionState enum values.
 */
export const getLiveKitConnectionStates = (): LiveKitSdk['ConnectionState'] => {
  const s = ensureSdk();
  return s.ConnectionState;
};

/**
 * Check whether the LiveKit SDK is available (native module installed).
 */
export const isLiveKitAvailable = (): boolean => {
  try {
    ensureSdk();
    return true;
  } catch {
    return false;
  }
};

// AudioSession is a process-global native singleton, so we ref-guard it with
// a module-level flag: started once when the first room connects, stopped when
// the last room closes. With one active room at a time this is exact.
let audioSessionStarted = false;

/**
 * Configure + start the native LiveKit AudioSession. Idempotent. MUST run
 * before `room.connect()` so Android sets the communication audio mode and
 * routes to the speaker (otherwise the mic captures but nothing is audible).
 * No-op when the native module is absent (Expo Go).
 */
export const startLiveKitAudioSession = async (): Promise<void> => {
  if (audioSessionStarted) return;
  let s: LiveKitSdk;
  try {
    s = ensureSdk();
  } catch {
    return; // native module unavailable — handled by the caller's sentinel
  }
  try {
    await s.AudioSession.configureAudio({
      android: {
        // Prefer the loudspeaker for a Clubhouse-style room; the OS still
        // overrides to a wired headset / Bluetooth when one is connected.
        preferredOutputList: ['speaker'],
        audioTypeOptions: s.AndroidAudioTypePresets.communication,
      },
      ios: { defaultOutput: 'speaker' },
    });
    await s.AudioSession.startAudioSession();
    audioSessionStarted = true;
  } catch {
    /* noop — leave audioSessionStarted false so a later attempt can retry */
  }
};

/**
 * Stop the native AudioSession, releasing audio focus back to the system.
 * Called when the last room closes.
 */
export const stopLiveKitAudioSession = async (): Promise<void> => {
  if (!sdk || !audioSessionStarted) return;
  try {
    await sdk.AudioSession.stopAudioSession();
  } catch {
    /* noop */
  }
  audioSessionStarted = false;
};

/**
 * Release/cleanup — for LiveKit this is a no-op at the global level
 * since rooms are per-session. Called on sign-out for symmetry with
 * the old Agora path.
 */
export const releaseLiveKit = (): void => {
  // LiveKit doesn't have a global singleton to release.
  // Each Room instance is disconnected individually.
  // This exists for API compatibility with the signOut path.
};

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
