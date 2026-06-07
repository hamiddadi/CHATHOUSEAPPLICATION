import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { env } from '../../../config/env';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { errorMessage } from '../../../shared/utils/errorMessage';
import { startRoomAudio, type RoomAudioHandle } from '../services/roomAudioService';

interface UseRoomAudioOptions {
  roomId: string | null;
  enabled?: boolean;
}

interface UseRoomAudioState {
  status: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error' | 'unsupported';
  error: string | null;
  /**
   * Additive convenience flag for UI banners — `true` while the LiveKit SDK
   * has lost the link and is auto-retrying (or we're driving a bounded
   * manual rejoin). Equivalent to `status === 'reconnecting'`; exposed as a
   * dedicated boolean so call sites can show a transient bandeau without
   * widening their `status` checks. Always `false` on the unsupported
   * (Expo Go) path, where connection-state callbacks never fire.
   */
  reconnecting: boolean;
  /**
   * Per-user "is currently speaking" flag, driven by LiveKit's
   * ActiveSpeakersChanged. Self is keyed under `__self__`. The map shape
   * (instead of a Set) keeps the existing call sites —
   * `audio.scores.get(userId) ?? 0` — working unchanged:
   * 0 = silent, 1 = speaking.
   */
  scores: ReadonlyMap<string, number>;
  setMuted: (muted: boolean) => Promise<void>;
  setPeerVolume: (userId: string, volume: number) => void;
}

const SELF_KEY = '__self__';

/**
 * Threshold against the `scores` map. With the LiveKit
 * ActiveSpeakersChanged-backed implementation the values are effectively
 * 0 or 1 (we feed the isSpeaking bit through), so any threshold in
 * (0, 1] works. Kept exported for call-site stability — RoomScreen
 * reads it to compute `isSpeakingLive`.
 */
export const SPEAKING_SCORE_THRESHOLD = 0.5;

export const useRoomAudio = ({
  roomId,
  enabled = true,
}: UseRoomAudioOptions): UseRoomAudioState => {
  const handleRef = useRef<RoomAudioHandle | null>(null);
  const [status, setStatus] = useState<UseRoomAudioState['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    if (!roomId || !enabled || !env.REALTIME_ENABLED) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('connecting');
    void (async () => {
      try {
        const socket = await getSocket();
        if (!socket) throw new Error('socket not connected');
        const handle = await startRoomAudio({
          socket,
          roomId,
          onLocalScore: level => {
            // Local mic level (0..1). Use the same threshold as VAD so
            // the local indicator behaves identically to remote ones.
            setScores(prev => {
              const next = new Map(prev);
              next.set(SELF_KEY, level >= SPEAKING_SCORE_THRESHOLD ? 1 : 0);
              return next;
            });
          },
          onPeerScore: ev => {
            // Use the explicit VAD bit when present, otherwise fall back
            // to the volume value above the threshold.
            const speaking = ev.speaking || ev.volume >= SPEAKING_SCORE_THRESHOLD;
            setScores(prev => {
              const next = new Map(prev);
              next.set(ev.userId, speaking ? 1 : 0);
              return next;
            });
          },
          onPeerGone: userId => {
            setScores(prev => {
              if (!prev.has(userId)) return prev;
              const next = new Map(prev);
              next.delete(userId);
              return next;
            });
          },
          onStatusChange: next => {
            // Connection-health transitions from the LiveKit SDK. Only ever
            // fires once the room is connected (never on the unsupported path),
            // so it's safe to map straight onto the hook's status:
            //   connected           → 'live'  (audio flowing again)
            //   reconnecting/failed  → 'reconnecting'  (service auto-rejoins
            //                          on failed; the banner stays up while
            //                          the bounded retry runs)
            // We never override a terminal 'error'/'unsupported' that the
            // start() catch block set, nor flip back before start() resolves.
            if (cancelled) return;
            setStatus(prev => {
              if (prev === 'error' || prev === 'unsupported' || prev === 'idle') {
                return prev;
              }
              return next === 'connected' ? 'live' : 'reconnecting';
            });
          },
        });
        if (cancelled) {
          await handle.close();
          return;
        }
        handleRef.current = handle;
        setStatus('live');
      } catch (err) {
        if (cancelled) return;
        const msg = errorMessage(err, 'unknown');
        const lower = msg.toLowerCase();
        // Treat "native audio unavailable" as `unsupported` so the UI shows the
        // friendly "audio requires a dev-client" banner instead of a hard error.
        // Two signatures mean the same thing — native WebRTC isn't usable here:
        //  - the explicit sentinel from LiveKitEngine, and
        //  - the opaque "cannot read property 'prototype' of undefined" /
        //    RTCPeerConnection errors thrown when registerGlobals couldn't
        //    install the WebRTC globals (defense-in-depth if one slips through).
        if (
          msg.includes('@livekit/react-native not installed') ||
          lower.includes('prototype') ||
          lower.includes('rtcpeerconnection')
        ) {
          setStatus('unsupported');
        } else {
          setStatus('error');
        }
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      const h = handleRef.current;
      handleRef.current = null;
      if (h) void h.close();
      setScores(new Map());
    };
  }, [roomId, enabled]);

  // Keep the controls stable: scores changes ~5x/s (200ms VAD ticks), so
  // binding these into the same memo would re-invalidate every consumer
  // that depends on them. They only ever read handleRef.current.
  const setMuted = useCallback(async (muted: boolean) => {
    await handleRef.current?.setMuted(muted);
  }, []);
  const setPeerVolume = useCallback((userId: string, volume: number) => {
    handleRef.current?.setPeerVolume(userId, volume);
  }, []);

  return useMemo(
    () => ({
      status,
      reconnecting: status === 'reconnecting',
      error,
      scores,
      setMuted,
      setPeerVolume,
    }),
    [error, scores, status, setMuted, setPeerVolume],
  );
};

export const SPEAKING_SELF_KEY = SELF_KEY;
