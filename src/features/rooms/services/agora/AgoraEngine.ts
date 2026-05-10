/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
/**
 * AgoraEngine — thin wrapper around `react-native-agora` that owns the
 * single global RtcEngine instance for the app. Lazy-loaded so the rest
 * of the codebase keeps booting in Expo Go (where the native module is
 * unavailable); the public functions early-return / throw a sentinel
 * when the SDK isn't present.
 *
 * Architecture choice — Agora replaces mediasoup as the audio engine.
 * Room presence + roles + chat + reactions still go through our HTTP +
 * Socket.IO layer (Participant model); Agora handles ONLY the audio bus.
 */

import { env } from '../../../../config/env';

interface AgoraSdk {
  createAgoraRtcEngine: () => AgoraEngineNative;
  ChannelProfileType: { ChannelProfileLiveBroadcasting: 1 } & Record<string, number>;
  ClientRoleType: {
    ClientRoleBroadcaster: 1;
    ClientRoleAudience: 2;
  };
  AudioProfileType: Record<string, number>;
  AudioScenarioType: Record<string, number>;
}

interface AgoraEngineNative {
  initialize: (config: { appId: string; channelProfile: number }) => number;
  release: () => void;
  enableAudio: () => number;
  disableAudio: () => number;
  setAudioProfile: (profile: number, scenario: number) => number;
  setClientRole: (role: number) => number;
  joinChannel: (token: string | null, channel: string, uid: number, options?: any) => number;
  leaveChannel: () => number;
  renewToken: (newToken: string) => number;
  muteLocalAudioStream: (mute: boolean) => number;
  enableAudioVolumeIndication: (interval: number, smooth: number, reportVad: boolean) => number;
  // react-native-agora v4 uses an EventEmitter-style API
  registerEventHandler: (handlers: AgoraEventHandlers) => number;
  unregisterEventHandler: (handlers: AgoraEventHandlers) => number;
}

export interface AgoraEventHandlers {
  onJoinChannelSuccess?: (
    connection: { channelId: string; localUid: number },
    elapsed: number,
  ) => void;
  onLeaveChannel?: (connection: { channelId: string; localUid: number }) => void;
  onUserJoined?: (connection: any, remoteUid: number, elapsed: number) => void;
  onUserOffline?: (connection: any, remoteUid: number, reason: number) => void;
  onAudioVolumeIndication?: (
    connection: any,
    speakers: { uid: number; volume: number; vad: number }[],
    speakerNumber: number,
    totalVolume: number,
  ) => void;
  onError?: (err: number, msg: string) => void;
  onConnectionStateChanged?: (connection: any, state: number, reason: number) => void;
  onTokenPrivilegeWillExpire?: (connection: any, token: string) => void;
}

const loadSdk = (): AgoraSdk | null => {
  try {
    return require('react-native-agora') as AgoraSdk;
  } catch {
    return null;
  }
};

export const AGORA_UNAVAILABLE_SENTINEL = 'AgoraEngine: react-native-agora not installed';

let engine: AgoraEngineNative | null = null;
let sdk: AgoraSdk | null = null;
let initialized = false;
let currentChannel: string | null = null;
let currentUid: number | null = null;

const ensureSdk = (): AgoraSdk => {
  if (sdk) return sdk;
  const loaded = loadSdk();
  if (!loaded) throw new Error(AGORA_UNAVAILABLE_SENTINEL);
  sdk = loaded;
  return loaded;
};

/**
 * Boot the singleton engine. Idempotent — subsequent calls return the
 * existing instance. AppId comes from `env.AGORA_APP_ID`; if missing we
 * throw with a clear message since the SDK would otherwise fail
 * cryptically inside the native layer.
 */
export const initAgora = async (): Promise<AgoraEngineNative> => {
  if (engine && initialized) return engine;
  const s = ensureSdk();
  if (!env.AGORA_APP_ID) {
    throw new Error('AgoraEngine: AGORA_APP_ID is not configured (check .env)');
  }
  engine = s.createAgoraRtcEngine();
  // ChannelProfileLiveBroadcasting (= 1) — the right profile for an
  // audio-room model with explicit roles (host/audience). Communication
  // profile would treat everyone as a publisher; we want listeners
  // muted at the SDK level until they're promoted.
  engine.initialize({
    appId: env.AGORA_APP_ID,
    channelProfile: s.ChannelProfileType.ChannelProfileLiveBroadcasting,
  });
  engine.enableAudio();
  // 5 = MUSIC_STANDARD, scenario 3 = GAME_STREAMING (low latency, music
  // bandwidth) — Clubhouse-grade sound. Tweak after measuring on real
  // devices; high-quality is generous for a phone speaker.
  engine.setAudioProfile(5, 3);
  // Volume indication every 200ms — drives the "who's speaking" UI.
  // smooth=3 averages over 3 windows; reportVad=true gives us a real
  // voice-activity-detection bit per speaker, which is what we use to
  // animate avatar rings (much better than producer score).
  engine.enableAudioVolumeIndication(200, 3, true);
  initialized = true;
  return engine;
};

export const joinAgoraChannel = async (params: {
  channelName?: string;
  uid: number;
  role: 'host' | 'audience';
  token?: string | null;
}): Promise<void> => {
  const eng = await initAgora();
  const s = ensureSdk();
  const channel = params.channelName ?? env.AGORA_DEFAULT_CHANNEL;
  // ClientRole: 1 = Broadcaster (host/speaker, can publish audio),
  //             2 = Audience (listener, receive-only).
  const role =
    params.role === 'host'
      ? s.ClientRoleType.ClientRoleBroadcaster
      : s.ClientRoleType.ClientRoleAudience;
  eng.setClientRole(role);
  // null token is ONLY allowed when the Agora project is in "App ID
  // only" mode. With certificates configured (our case), a token is
  // mandatory — the temp dev token works for ~24h, prod must hit the
  // backend's per-room signing endpoint.
  const token = params.token ?? env.AGORA_TEMP_TOKEN ?? null;
  eng.joinChannel(token, channel, params.uid);
  currentChannel = channel;
  currentUid = params.uid;
};

export const leaveAgoraChannel = async (): Promise<void> => {
  if (!engine) return;
  engine.leaveChannel();
  currentChannel = null;
  currentUid = null;
};

export const setAgoraMuted = async (muted: boolean): Promise<void> => {
  if (!engine) return;
  engine.muteLocalAudioStream(muted);
};

export const setAgoraRole = async (role: 'host' | 'audience'): Promise<void> => {
  if (!engine) return;
  const s = ensureSdk();
  engine.setClientRole(
    role === 'host' ? s.ClientRoleType.ClientRoleBroadcaster : s.ClientRoleType.ClientRoleAudience,
  );
};

/**
 * Hot-swap the channel token without leaving the channel. Triggered by
 * the `onTokenPrivilegeWillExpire` callback ~30s before the current
 * token's expiry.
 */
export const renewAgoraToken = async (newToken: string): Promise<void> => {
  if (!engine) return;
  engine.renewToken(newToken);
};

export const releaseAgora = (): void => {
  if (!engine) return;
  try {
    engine.release();
  } catch {
    /* noop */
  }
  engine = null;
  initialized = false;
  currentChannel = null;
  currentUid = null;
};

export const registerAgoraHandlers = (handlers: AgoraEventHandlers): (() => void) => {
  if (!engine) return () => undefined;
  engine.registerEventHandler(handlers);
  return () => {
    engine?.unregisterEventHandler(handlers);
  };
};

export const isAgoraReady = (): boolean => initialized && engine !== null;

export const getCurrentAgoraSession = (): { channel: string | null; uid: number | null } => ({
  channel: currentChannel,
  uid: currentUid,
});

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
