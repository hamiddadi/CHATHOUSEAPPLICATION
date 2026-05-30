import { redis } from '../../../config/redis';

/**
 * Audio quality tier preferences (Module 6.2 / 17.2 / AUDIO-004..006).
 *
 * Stored in Redis (no schema migration). Mediasoup's actual codec config
 * stays the existing Opus baseline; the tier selection is a *client hint*
 * the mobile app reads to set its sending bitrate / DTX / sample rate.
 */

export type AudioQualityTier = 'standard' | 'high' | 'music';
export type DropInMode = 'silent' | 'normal';

interface AudioPreferences {
  qualityTier: AudioQualityTier;
  spatialAudio: boolean;
  noiseSuppression: boolean;
  dropInMode: DropInMode;
}

const DEFAULTS: AudioPreferences = {
  qualityTier: 'standard',
  spatialAudio: false,
  noiseSuppression: true,
  dropInMode: 'normal',
};

const key = (userId: string) => `ext:audio:prefs:${userId}`;

const coerceTier = (t: unknown): AudioQualityTier =>
  t === 'high' || t === 'music' ? t : 'standard';

const coerceDropIn = (m: unknown): DropInMode => (m === 'silent' ? 'silent' : 'normal');

const parse = (raw: string | null): AudioPreferences => {
  if (!raw) return DEFAULTS;
  try {
    const obj = JSON.parse(raw) as Partial<AudioPreferences>;
    return {
      qualityTier: coerceTier(obj.qualityTier),
      spatialAudio: typeof obj.spatialAudio === 'boolean' ? obj.spatialAudio : false,
      noiseSuppression: typeof obj.noiseSuppression === 'boolean' ? obj.noiseSuppression : true,
      dropInMode: coerceDropIn(obj.dropInMode),
    };
  } catch {
    return DEFAULTS;
  }
};

export const audioService = {
  async get(userId: string): Promise<AudioPreferences> {
    const raw = await redis.get(key(userId));
    return parse(raw);
  },

  async update(userId: string, patch: Partial<AudioPreferences>): Promise<AudioPreferences> {
    const current = await this.get(userId);
    const next: AudioPreferences = {
      ...current,
      ...patch,
    };
    // Validate tier
    if (
      next.qualityTier !== 'standard' &&
      next.qualityTier !== 'high' &&
      next.qualityTier !== 'music'
    ) {
      next.qualityTier = current.qualityTier;
    }
    if (next.dropInMode !== 'silent' && next.dropInMode !== 'normal') {
      next.dropInMode = current.dropInMode;
    }
    await redis.set(key(userId), JSON.stringify(next));
    return next;
  },

  /**
   * Return the mediasoup-compatible client hints for a given tier. The
   * mobile app feeds these into its producer constraints.
   */
  hintsForTier(tier: AudioQualityTier): {
    maxBitrate: number;
    sampleRate: number;
    stereo: boolean;
    dtx: boolean;
  } {
    switch (tier) {
      case 'music':
        return { maxBitrate: 128_000, sampleRate: 48_000, stereo: true, dtx: false };
      case 'high':
        return { maxBitrate: 64_000, sampleRate: 48_000, stereo: false, dtx: false };
      case 'standard':
      default:
        return { maxBitrate: 32_000, sampleRate: 48_000, stereo: false, dtx: true };
    }
  },
};

export type { AudioPreferences };
