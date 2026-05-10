import os from 'node:os';
import { env } from './env';

/**
 * Opus with FEC (forward error correction) and DTX (discontinuous transmission,
 * saves bandwidth during silence). sprop-stereo=1 keeps the payload format
 * compatible with 2-channel clients even though we default to mono mic capture.
 */
export const MEDIA_CODECS = [
  {
    kind: 'audio' as const,
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    parameters: {
      'sprop-stereo': 1,
      useinbandfec: 1,
      usedtx: 1,
    },
  },
];

export const numWorkersToSpawn = (): number =>
  env.MEDIASOUP_NUM_WORKERS ?? Math.max(1, os.cpus().length);

export const workerSettings = {
  logLevel: 'warn' as const,
  logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'] as const,
  rtcMinPort: env.MEDIASOUP_RTC_MIN_PORT,
  rtcMaxPort: env.MEDIASOUP_RTC_MAX_PORT,
};

export const webRtcTransportOptions = {
  listenIps: [{ ip: env.MEDIASOUP_LISTEN_IP, announcedIp: env.MEDIASOUP_ANNOUNCED_IP }],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 600_000,
};
