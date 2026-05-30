import { redis } from '../../../config/redis';
import { prisma } from '../../../config/database';
import { AppError } from '../../../middlewares/error.middleware';

/**
 * Network quality tracker (Module 6.4 / AUDIO-009/010).
 *
 * Clients periodically POST their measured RTT / jitter / packet-loss; the
 * service classifies them into 3 levels (poor/fair/good) — the canonical
 * 3-bar indicator Clubhouse displays. The latest value is stored in Redis
 * with a short TTL so a stale value naturally degrades to "unknown".
 *
 * The server-side rule is intentionally simple — the device is the source
 * of truth via WebRTC getStats().
 */
export type NetQualityBars = 1 | 2 | 3;

export interface NetQualityReport {
  rttMs: number; // average round-trip time
  jitterMs: number;
  packetLossPct: number; // 0-100
  bars: NetQualityBars;
  warning: 'high_latency' | 'unstable' | 'poor' | null;
  measuredAt: string;
}

const TTL_S = 30;
const key = (userId: string, roomId: string) => `ext:netq:${roomId}:${userId}`;

// Classification thresholds (close approximation of Clubhouse's 3-bar indicator).
const RTT_CRITICAL_MS = 1000;
const RTT_POOR_MS = 350;
const RTT_FAIR_MS = 150;
const JITTER_POOR_MS = 80;
const JITTER_FAIR_MS = 30;
const LOSS_POOR_PCT = 5;
const LOSS_FAIR_PCT = 1;

export const netqualityService = {
  classify(
    rttMs: number,
    jitterMs: number,
    packetLossPct: number,
  ): {
    bars: NetQualityBars;
    warning: NetQualityReport['warning'];
  } {
    // Clubhouse-style thresholds (close approximation):
    //  - 3 bars: RTT < 150ms, jitter < 30ms, loss < 1%
    //  - 2 bars: RTT < 350ms, jitter < 80ms, loss < 5%
    //  - 1 bar : worse
    let bars: NetQualityBars = 3;
    if (rttMs >= RTT_CRITICAL_MS) bars = 1;
    else if (rttMs >= RTT_POOR_MS || jitterMs >= JITTER_POOR_MS || packetLossPct >= LOSS_POOR_PCT)
      bars = 1;
    else if (rttMs >= RTT_FAIR_MS || jitterMs >= JITTER_FAIR_MS || packetLossPct >= LOSS_FAIR_PCT)
      bars = 2;

    let warning: NetQualityReport['warning'] = null;
    if (rttMs >= RTT_CRITICAL_MS) warning = 'high_latency';
    else if (packetLossPct >= LOSS_POOR_PCT) warning = 'poor';
    else if (jitterMs >= JITTER_POOR_MS) warning = 'unstable';
    return { bars, warning };
  },

  async report(
    userId: string,
    roomId: string,
    rttMs: number,
    jitterMs: number,
    packetLossPct: number,
  ): Promise<NetQualityReport> {
    // Only an active participant of the room may report metrics for it —
    // otherwise any authenticated user could write arbitrary Redis keys
    // bounded only by roomId validation.
    const participant = await prisma.participant.findUnique({
      where: { userId_roomId: { userId, roomId } },
      select: { leftAt: true },
    });
    if (!participant || participant.leftAt) {
      throw new AppError('AUTH_008');
    }

    const { bars, warning } = this.classify(rttMs, jitterMs, packetLossPct);
    const report: NetQualityReport = {
      rttMs,
      jitterMs,
      packetLossPct,
      bars,
      warning,
      measuredAt: new Date().toISOString(),
    };
    await redis.setEx(key(userId, roomId), TTL_S, JSON.stringify(report));
    return report;
  },

  async get(userId: string, roomId: string): Promise<NetQualityReport | null> {
    const raw = await redis.get(key(userId, roomId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as NetQualityReport;
    } catch {
      return null;
    }
  },
};
