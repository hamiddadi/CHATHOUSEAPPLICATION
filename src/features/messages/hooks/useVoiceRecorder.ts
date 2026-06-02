import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';

// Clamp the captured length so the backend (durationMs ≤ 5 min) never rejects a
// send on duration, and ignore taps so short they produce no real audio.
const MAX_DURATION_MS = 5 * 60 * 1000;
const MIN_DURATION_MS = 600;

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
 * Thin wrapper around expo-audio's recorder for async voice messages. Owns the
 * permission prompt, the audio-session toggle, and an elapsed-time ticker, and
 * hands back the recorded file URI + length. Recording uses a native module, so
 * it only works in a dev/EAS build (not Expo Go) — the same constraint LiveKit
 * already imposes on this app.
 */
export const useVoiceRecorder = (): VoiceRecorder => {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const teardown = useCallback(async () => {
    try {
      await recorder.stop();
    } catch (err) {
      console.warn('[voice] recorder stop failed', err);
    }
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch (err) {
      console.warn('[voice] reset audio mode failed', err);
    }
  }, [recorder]);

  const start = useCallback(async (): Promise<boolean> => {
    if (activeRef.current) return false;
    setIsPreparing(true);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setIsPreparing(false);
        return false;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAtRef.current = Date.now();
      activeRef.current = true;
      setElapsedMs(0);
      setIsRecording(true);
      setIsPreparing(false);
      clearTimer();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 200);
      return true;
    } catch (err) {
      console.warn('[voice] start recording failed', err);
      activeRef.current = false;
      setIsPreparing(false);
      setIsRecording(false);
      clearTimer();
      await teardown();
      return false;
    }
  }, [recorder, clearTimer, teardown]);

  const finish = useCallback(async (): Promise<RecordedClip | null> => {
    if (!activeRef.current) return null;
    clearTimer();
    const durationMs = Math.min(MAX_DURATION_MS, Date.now() - startedAtRef.current);
    activeRef.current = false;
    setIsRecording(false);
    setElapsedMs(0);
    await teardown();
    const uri = recorder.uri;
    if (!uri || durationMs < MIN_DURATION_MS) return null;
    return { uri, durationMs };
  }, [recorder, clearTimer, teardown]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!activeRef.current) return;
    clearTimer();
    activeRef.current = false;
    setIsRecording(false);
    setElapsedMs(0);
    await teardown();
  }, [clearTimer, teardown]);

  // Stop a live recording if the screen unmounts mid-record (back button, etc.).
  useEffect(
    () => () => {
      clearTimer();
      if (activeRef.current) {
        activeRef.current = false;
        void teardown();
      }
    },
    [clearTimer, teardown],
  );

  return { isRecording, isPreparing, elapsedMs, start, finish, cancel };
};
