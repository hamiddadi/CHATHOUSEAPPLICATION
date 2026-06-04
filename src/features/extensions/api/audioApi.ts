import { apiClient } from '../../../shared/services/api/apiClient';

export type AudioQualityTier = 'standard' | 'high' | 'music';
export type DropInMode = 'silent' | 'normal';

export interface AudioPreferences {
  qualityTier: AudioQualityTier;
  spatialAudio: boolean;
  noiseSuppression: boolean;
  dropInMode: DropInMode;
  hints: {
    maxBitrate: number;
    sampleRate: number;
    stereo: boolean;
    dtx: boolean;
  };
}

export const audioApi = {
  async get(): Promise<AudioPreferences> {
    const { data } = await apiClient.get<AudioPreferences>('/ext/audio');
    return data;
  },
  async update(patch: Partial<Omit<AudioPreferences, 'hints'>>): Promise<AudioPreferences> {
    const { data } = await apiClient.patch<AudioPreferences>('/ext/audio', patch);
    return data;
  },
};
