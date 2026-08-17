import type {
  AudioQualityTier as DbAudioQualityTier,
  DropInMode as DbDropInMode,
  UserAudioPreference,
} from '@prisma/client';
import { prisma } from '../../../config/database';
import { redis } from '../../../config/redis';
import { ensureUserExtensionImported } from '../../utils/legacyExtensionImport';

/** PostgreSQL-backed client audio hints with one-time legacy Redis import. */
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

const IMPORT_NAMESPACE = 'audio-preferences-v1';
const key = (userId: string) => `ext:audio:prefs:${userId}`;

const coerceTier = (tier: unknown): AudioQualityTier =>
  tier === 'high' || tier === 'music' ? tier : 'standard';
const coerceDropIn = (mode: unknown): DropInMode => (mode === 'silent' ? 'silent' : 'normal');

const parse = (raw: string | null): AudioPreferences => {
  if (!raw) return { ...DEFAULTS };
  try {
    const obj = JSON.parse(raw) as Partial<AudioPreferences>;
    return {
      qualityTier: coerceTier(obj.qualityTier),
      spatialAudio: typeof obj.spatialAudio === 'boolean' ? obj.spatialAudio : false,
      noiseSuppression: typeof obj.noiseSuppression === 'boolean' ? obj.noiseSuppression : true,
      dropInMode: coerceDropIn(obj.dropInMode),
    };
  } catch {
    return { ...DEFAULTS };
  }
};

const toDbTier = (tier: AudioQualityTier): DbAudioQualityTier =>
  tier.toUpperCase() as DbAudioQualityTier;
const toDbDropIn = (mode: DropInMode): DbDropInMode => mode.toUpperCase() as DbDropInMode;

const toApi = (row: UserAudioPreference | null): AudioPreferences =>
  row
    ? {
        qualityTier: row.qualityTier.toLowerCase() as AudioQualityTier,
        spatialAudio: row.spatialAudio,
        noiseSuppression: row.noiseSuppression,
        dropInMode: row.dropInMode.toLowerCase() as DropInMode,
      }
    : { ...DEFAULTS };

const ensureImported = async (userId: string): Promise<void> => {
  await ensureUserExtensionImported(
    IMPORT_NAMESPACE,
    userId,
    async () => parse(await redis.get(key(userId))),
    async (tx, legacy) => {
      await tx.userAudioPreference.createMany({
        data: [
          {
            userId,
            qualityTier: toDbTier(legacy.qualityTier),
            spatialAudio: legacy.spatialAudio,
            noiseSuppression: legacy.noiseSuppression,
            dropInMode: toDbDropIn(legacy.dropInMode),
          },
        ],
        skipDuplicates: true,
      });
    },
  );
};

const get = async (userId: string): Promise<AudioPreferences> => {
  await ensureImported(userId);
  return toApi(await prisma.userAudioPreference.findUnique({ where: { userId } }));
};

export const audioService = {
  get,

  async update(userId: string, patch: Partial<AudioPreferences>): Promise<AudioPreferences> {
    await ensureImported(userId);
    const qualityTier = patch.qualityTier ? coerceTier(patch.qualityTier) : undefined;
    const dropInMode = patch.dropInMode ? coerceDropIn(patch.dropInMode) : undefined;
    const row = await prisma.userAudioPreference.upsert({
      where: { userId },
      create: {
        userId,
        qualityTier: toDbTier(qualityTier ?? DEFAULTS.qualityTier),
        spatialAudio: patch.spatialAudio ?? DEFAULTS.spatialAudio,
        noiseSuppression: patch.noiseSuppression ?? DEFAULTS.noiseSuppression,
        dropInMode: toDbDropIn(dropInMode ?? DEFAULTS.dropInMode),
      },
      update: {
        ...(qualityTier ? { qualityTier: toDbTier(qualityTier) } : {}),
        ...(patch.spatialAudio !== undefined ? { spatialAudio: patch.spatialAudio } : {}),
        ...(patch.noiseSuppression !== undefined
          ? { noiseSuppression: patch.noiseSuppression }
          : {}),
        ...(dropInMode ? { dropInMode: toDbDropIn(dropInMode) } : {}),
      },
    });
    return toApi(row);
  },

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
