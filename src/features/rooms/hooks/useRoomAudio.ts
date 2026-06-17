import { useCallback, useEffect, useMemo } from 'react';
import { env } from '../../../config/env';
import {
  roomAudioSession,
  useRoomAudioStore,
  SELF_KEY,
  type RoomAudioStatus,
} from '../services/roomAudioSession';

interface UseRoomAudioOptions {
  roomId: string | null;
  enabled?: boolean;
}

interface UseRoomAudioState {
  status: RoomAudioStatus;
  error: string | null;
  /**
   * Additive convenience flag for UI banners — `true` while the LiveKit SDK
   * has lost the link and is auto-retrying (or we're driving a bounded
   * manual rejoin). Equivalent to `status === 'reconnecting'`.
   */
  reconnecting: boolean;
  /**
   * Per-user "is currently speaking" flag, driven by LiveKit's
   * ActiveSpeakersChanged. Self is keyed under `__self__`.
   * 0 = silent, 1 = speaking.
   */
  scores: ReadonlyMap<string, number>;
  setMuted: (muted: boolean) => Promise<void>;
  setPeerVolume: (userId: string, volume: number) => void;
}

const EMPTY_SCORES: ReadonlyMap<string, number> = new Map();

/**
 * Threshold against the `scores` map (values are effectively 0/1). Kept
 * exported for call-site stability — RoomScreen reads it to compute
 * `isSpeakingLive`.
 */
export const SPEAKING_SCORE_THRESHOLD = 0.5;

/**
 * Thin subscriber over {@link roomAudioSession}. It asks the singleton session
 * to connect the room (idempotent) and reflects its reactive state — but it
 * deliberately does NOT close the session on unmount, so audio keeps playing
 * when the user navigates away (mini-bar) or backgrounds the app. The session
 * is closed explicitly on leave/kick/room-end via `roomAudioSession.stop()`.
 */
export const useRoomAudio = ({
  roomId,
  enabled = true,
}: UseRoomAudioOptions): UseRoomAudioState => {
  const activeRoomId = useRoomAudioStore(s => s.roomId);
  const rawStatus = useRoomAudioStore(s => s.status);
  const rawError = useRoomAudioStore(s => s.error);
  const rawScores = useRoomAudioStore(s => s.scores);

  useEffect(() => {
    if (!roomId || !enabled || !env.REALTIME_ENABLED) return;
    void roomAudioSession.start(roomId);
    // No cleanup: the session outlives this screen on purpose.
  }, [roomId, enabled]);

  const setMuted = useCallback(async (muted: boolean) => {
    await roomAudioSession.setMuted(muted);
  }, []);
  const setPeerVolume = useCallback((userId: string, volume: number) => {
    roomAudioSession.setPeerVolume(userId, volume);
  }, []);

  // Only surface state that belongs to THIS room — if the singleton is bound to
  // another room (or none), this screen sees a clean idle.
  const isThisRoom = Boolean(roomId) && activeRoomId === roomId;
  const status: RoomAudioStatus = isThisRoom ? rawStatus : 'idle';
  const scores = isThisRoom ? rawScores : EMPTY_SCORES;
  const error = isThisRoom ? rawError : null;

  return useMemo(
    () => ({
      status,
      reconnecting: status === 'reconnecting',
      error,
      scores,
      setMuted,
      setPeerVolume,
    }),
    [status, error, scores, setMuted, setPeerVolume],
  );
};

export const SPEAKING_SELF_KEY = SELF_KEY;
