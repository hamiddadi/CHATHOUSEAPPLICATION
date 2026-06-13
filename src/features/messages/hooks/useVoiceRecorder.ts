import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid } from 'react-native';
import {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  OutputFormatAndroidType,
} from 'react-native-audio-recorder-player';
import {
  audioRecorderPlayer,
  useVoicePlayback,
} from '../../../shared/services/audio/voicePlayback';

// Clamp the captured length so the backend (durationMs ≤ 5 min) never rejects a
// send on duration, and ignore taps so short they produce no real audio.
const MAX_DURATION_MS = 5 * 60 * 1000;
const MIN_DURATION_MS = 600;

// MPEG-4 container + AAC → a `.mp4` file the backend upload whitelist accepts
// (voiceService EXT_MIME maps mp4/m4a/aac). RNARP's default Android output path
// already uses `.mp4`, so we don't pass an explicit uri.
const AUDIO_SET = {
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
};

export interface RecordedClip {
  uri: string;
  durationMs: number;
}

export interface VoiceRecorder {
  isRecording: boolean;
  isPreparing: boolean;
  elapsedMs: number;
  /** Request permission + begin recording. Resolves false if denied/failed. */
  start: () => Promise<boolean>;
  /** Stop and return the clip (null if it was too short or never started). */
  finish: () => Promise<RecordedClip | null>;
  /** Stop and discard. */
  cancel: () => Promise<void>;
}

/**
 * Thin wrapper around react-native-audio-recorder-player's recorder for async
 * voice messages (de-Expo: was expo-audio). Shares the single recorder+player
 * instance with the playback store. Owns the permission prompt and an
 * elapsed-time read-out, and hands back the recorded file URI + length.
 * Recording uses a native module, so it only works in a dev/EAS build (not Expo
 * Go) — the same constraint LiveKit already imposes on this app.
 */
export const useVoiceRecorder = (): VoiceRecorder => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const activeRef = useRef(false);
  const lastPosRef = useRef(0);
  const uriRef = useRef<string | null>(null);

  const teardownRecorder = useCallback(async (): Promise<string | null> => {
    audioRecorderPlayer.removeRecordBackListener();
    try {
      const result = await audioRecorderPlayer.stopRecorder();
      return result || uriRef.current;
    } catch (err) {
      console.warn('[voice] recorder stop failed', err);
      return uriRef.current;
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (activeRef.current) return false;
    setIsPreparing(true);
    try {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        setIsPreparing(false);
        return false;
      }
      // The recorder + player share one native instance — stop any voice note
      // that's currently playing before we capture.
      await useVoicePlayback.getState().stop();

      lastPosRef.current = 0;
      const uri = await audioRecorderPlayer.startRecorder(undefined, AUDIO_SET);
      uriRef.current = uri;
      audioRecorderPlayer.addRecordBackListener(e => {
        lastPosRef.current = e.currentPosition;
        setElapsedMs(e.currentPosition);
      });
      activeRef.current = true;
      setElapsedMs(0);
      setIsRecording(true);
      setIsPreparing(false);
      return true;
    } catch (err) {
      console.warn('[voice] start recording failed', err);
      activeRef.current = false;
      setIsPreparing(false);
      setIsRecording(false);
      await teardownRecorder();
      return false;
    }
  }, [teardownRecorder]);

  const finish = useCallback(async (): Promise<RecordedClip | null> => {
    if (!activeRef.current) return null;
    const durationMs = Math.min(MAX_DURATION_MS, lastPosRef.current);
    activeRef.current = false;
    setIsRecording(false);
    const uri = await teardownRecorder();
    setElapsedMs(0);
    if (!uri || durationMs < MIN_DURATION_MS) return null;
    // voiceService.upload reads the file via fetch(), which needs a file:// URI.
    const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
    return { uri: fileUri, durationMs };
  }, [teardownRecorder]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setIsRecording(false);
    setElapsedMs(0);
    await teardownRecorder();
  }, [teardownRecorder]);

  // Stop a live recording if the screen unmounts mid-record (back button, etc.).
  useEffect(
    () => () => {
      if (activeRef.current) {
        activeRef.current = false;
        audioRecorderPlayer.removeRecordBackListener();
        void audioRecorderPlayer.stopRecorder().catch(() => undefined);
      }
    },
    [],
  );

  return { isRecording, isPreparing, elapsedMs, start, finish, cancel };
};
