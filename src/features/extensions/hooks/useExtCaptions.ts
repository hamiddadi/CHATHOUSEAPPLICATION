import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../../../shared/services/realtime/socketClient';
import { useSocketStore } from '../../../shared/services/realtime/socketStore';
import { captionsApi } from '../api/captionsApi';

/**
 * Live-captions client (Module 16.1 / ACCESS-001..003).
 *
 * Subscribes to the canonical `room:captions` socket event the backend
 * emits when the ASR worker pushes a transcript line. Keeps a rolling
 * window of the last N lines so the UI can render them like Clubhouse's
 * floating subtitles.
 *
 * The actual ASR pipeline is feature-flagged on the backend (Vague 7
 * captions module). When `configured === false`, the hook still exposes
 * the toggle but no transcripts arrive — UI hides the captions strip.
 */

export interface CaptionLine {
  id: string;
  speakerId: string;
  speakerName: string | null;
  text: string;
  isFinal: boolean;
  at: number;
}

const ROLLING_WINDOW = 12;
const STALE_MS = 30_000;

export const useExtCaptions = (roomId: string | null) => {
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabledLocal] = useState(false);
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const linesRef = useRef<CaptionLine[]>([]);
  linesRef.current = lines;
  // Re-run the subscription effect whenever the realtime connection state
  // changes so a socket that wasn't ready at mount (slow network, momentary
  // disconnect) re-subscribes once it (re)connects, instead of dropping the
  // captions stream until roomId/enabled happen to change.
  const socketStatus = useSocketStore(s => s.status);

  // Bootstrap : provider configured + per-room flag
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await captionsApi.status();
        if (cancelled) return;
        setConfigured(status.configured);
        if (status.configured && roomId) {
          const ena = await captionsApi.isEnabled(roomId);
          if (!cancelled) setEnabledLocal(ena);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Subscribe to caption stream — listens to two canonical event names so
  // the wiring is robust to which backend layer emits the line.
  useEffect(() => {
    if (!roomId || !enabled) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await getSocket();
      if (cancelled || !socket) return;

      const onLine = (payload: CaptionLine): void => {
        // Upsert by id: an interim line (isFinal=false) and its final share the
        // same id, so replace in place instead of appending — otherwise the
        // rolling window holds duplicate-key rows and the caption repeats.
        const fresh = linesRef.current.filter(l => Date.now() - l.at < STALE_MS);
        const idx = fresh.findIndex(l => l.id === payload.id);
        const merged =
          idx >= 0 ? fresh.map((l, i) => (i === idx ? payload : l)) : [...fresh, payload];
        const next =
          merged.length > ROLLING_WINDOW ? merged.slice(merged.length - ROLLING_WINDOW) : merged;
        setLines(next);
      };

      socket.on('room:caption', onLine);
      socket.on('caption_line', onLine);
      cleanup = () => {
        socket.off('room:caption', onLine);
        socket.off('caption_line', onLine);
      };
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, [roomId, enabled, socketStatus]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      if (!roomId || !configured) return;
      try {
        const res = await captionsApi.setEnabled(roomId, next);
        setEnabledLocal(res.enabled);
        if (!res.enabled) setLines([]);
      } catch {
        /* surface a toast in the consumer if needed */
      }
    },
    [roomId, configured],
  );

  return { configured, enabled, setEnabled, lines };
};
