import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import Voice, { type SpeechResultsEvent, type SpeechErrorEvent } from '@react-native-voice/voice';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useAuthStore } from '../../auth/store/authStore';

/**
 * On-device live-captions PUBLISHER.
 *
 * When captions are ON for the room and the local user is a *speaker*, this
 * runs the platform speech recogniser (`@react-native-voice/voice` →
 * Android SpeechRecognizer / iOS Speech) on the local mic and streams the
 * recognised text up as `caption:publish`. The backend relay
 * ({@link file://backend/src/extensions/realtime/captions.realtime.ts})
 * authorises it and fans it out to the room as `room:caption`, which every
 * client renders via `useExtCaptions` + `ExtCaptionsOverlay`. Free — no paid
 * ASR key, no server audio pipeline.
 *
 * ⚠️ Device caveat: on Android the system recogniser and WebRTC (LiveKit) both
 * want the microphone. Whether they can share it is device/HAL-dependent — on
 * hardware that refuses a second mic consumer, `Voice.start()` rejects and this
 * hook simply produces nothing (best-effort, never throws). Requires a native
 * rebuild (the lib autolinks) — it no-ops under jest via the manual mock.
 *
 * Pass `active = captionsEnabled && viewerCanSpeak && !muted`.
 */

interface UseLocalCaptionPublisherOpts {
  roomId: string | null;
  active: boolean;
  /** BCP-47 tag for the recogniser; defaults to the device-agnostic en-US. */
  locale?: string;
}

const RESTART_DELAY_MS = 400;

export const useLocalCaptionPublisher = ({
  roomId,
  active,
  locale = 'en-US',
}: UseLocalCaptionPublisherOpts): void => {
  const socketRef = useRef<Socket | null>(null);
  const activeRef = useRef(false);
  // Monotonic per-utterance counter: a partial line and its final share one id
  // so the overlay upserts in place; the next utterance gets a fresh id.
  const utteranceRef = useRef(0);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeRef.current = active && Boolean(roomId);
    if (!roomId || !active) return;

    let cancelled = false;
    const me = useAuthStore.getState().user;
    const speakerName = me?.displayName ?? me?.username ?? null;
    const myId = me?.id ?? 'me';

    const utteranceId = (): string => `cap:${myId}:${utteranceRef.current}`;

    const emit = (text: string, isFinal: boolean): void => {
      const s = socketRef.current;
      if (!s?.connected || !text) return;
      s.emit('caption:publish', { roomId, id: utteranceId(), text, isFinal, speakerName });
    };

    const scheduleRestart = (): void => {
      if (restartTimer.current) clearTimeout(restartTimer.current);
      restartTimer.current = setTimeout(() => {
        if (!cancelled && activeRef.current) void startRecognition();
      }, RESTART_DELAY_MS);
    };

    const startRecognition = async (): Promise<void> => {
      if (cancelled || !activeRef.current) return;
      try {
        await Voice.start(locale);
      } catch {
        // Mic busy (LiveKit) or recogniser unavailable — retry with backoff.
        scheduleRestart();
      }
    };

    Voice.onSpeechPartialResults = (e: SpeechResultsEvent): void => {
      const text = e.value?.[0];
      if (text) emit(text, false);
    };
    Voice.onSpeechResults = (e: SpeechResultsEvent): void => {
      const text = e.value?.[0];
      if (text) emit(text, true);
      utteranceRef.current += 1; // close this utterance
    };
    Voice.onSpeechEnd = (): void => {
      // The session ends on silence; restart to keep captioning continuously.
      scheduleRestart();
    };
    Voice.onSpeechError = (_e: SpeechErrorEvent): void => {
      utteranceRef.current += 1;
      scheduleRestart();
    };

    void (async () => {
      try {
        const s = await getSocket();
        if (cancelled) return;
        socketRef.current = s;
      } catch {
        /* no socket → nothing to publish to, but still start so it's ready */
      }
      void startRecognition();
    })();

    return () => {
      cancelled = true;
      activeRef.current = false;
      if (restartTimer.current) clearTimeout(restartTimer.current);
      void Voice.stop().catch(() => undefined);
      void Voice.destroy().catch(() => undefined);
      Voice.removeAllListeners();
    };
  }, [roomId, active, locale]);
};
