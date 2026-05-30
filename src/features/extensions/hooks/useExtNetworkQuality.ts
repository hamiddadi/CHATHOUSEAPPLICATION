import { useEffect, useRef, useState } from 'react';
import { netqualityApi, type NetQualityReport } from '../api/netqualityApi';

/**
 * Periodically samples WebRTC getStats() (when available), classifies the
 * sample into a 1-3 bar score via the backend's `netqualityService`, and
 * exposes the latest report to the UI.
 *
 * The mediasoup-rtc layer in this repo is intentionally optional; when
 * unavailable (Expo Go without dev-client), the hook still works but only
 * reports the server's last cached value (`null` until a real sample lands).
 *
 * Usage:
 *   const { report, isReporting } = useExtNetworkQuality(roomId);
 */

const SAMPLE_INTERVAL_MS = 10_000;

export interface UseExtNetworkQualityOpts {
  /**
   * Function the caller provides to read the current WebRTC stats. When
   * mediasoup is unavailable, return `null` and the hook will skip the
   * sampling (only reads server cache).
   */
  sampler?: () => Promise<{
    rttMs: number;
    jitterMs: number;
    packetLossPct: number;
  } | null>;
  enabled?: boolean;
}

export const useExtNetworkQuality = (
  roomId: string | null,
  opts: UseExtNetworkQualityOpts = {},
): { report: NetQualityReport | null; isReporting: boolean } => {
  const [report, setReport] = useState<NetQualityReport | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const samplerRef = useRef(opts.sampler);
  samplerRef.current = opts.sampler;

  useEffect(() => {
    if (!roomId || opts.enabled === false) return;

    let cancelled = false;

    const tick = async (): Promise<void> => {
      setIsReporting(true);
      try {
        const sampler = samplerRef.current;
        let payload: NetQualityReport | null = null;
        if (sampler) {
          const stats = await sampler();
          if (stats) {
            payload = await netqualityApi.report(
              roomId,
              stats.rttMs,
              stats.jitterMs,
              stats.packetLossPct,
            );
          }
        }
        if (!payload) {
          payload = await netqualityApi.get(roomId);
        }
        if (!cancelled) setReport(payload);
      } catch {
        /* swallow — UI degrades to last known */
      } finally {
        if (!cancelled) setIsReporting(false);
      }
    };

    void tick();
    const id = setInterval(() => void tick(), SAMPLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [roomId, opts.enabled]);

  return { report, isReporting };
};
