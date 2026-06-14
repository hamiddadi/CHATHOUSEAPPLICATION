/**
 * Render-test for ExtSettingsScreen. The screen loads audio + privacy prefs via
 * Promise.all(audioApi.get, privacyApi.get) and shows a loader until both
 * resolve. We mock both APIs so it renders deterministically offline, then
 * exercise an audio-quality radio (audioApi.update) and a privacy switch
 * (privacyApi.update). Native modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { audioApi, type AudioPreferences } from '../api/audioApi';
import { privacyApi, type PrivacySettings } from '../api/privacyApi';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { ExtSettingsScreen } from './ExtSettingsScreen';

// Self-contained factories (jest.fn()s live inside) — read back off the mocked
// modules so the factory references no out-of-scope vars and the screen import
// stays a normal top-level import.
jest.mock('../api/audioApi', () => ({ audioApi: { get: jest.fn(), update: jest.fn() } }));
jest.mock('../api/privacyApi', () => ({ privacyApi: { get: jest.fn(), update: jest.fn() } }));

const mockAudioGet = audioApi.get as jest.Mock;
const mockAudioUpdate = audioApi.update as jest.Mock;
const mockPrivacyGet = privacyApi.get as jest.Mock;
const mockPrivacyUpdate = privacyApi.update as jest.Mock;

const AUDIO: AudioPreferences = {
  qualityTier: 'standard',
  spatialAudio: false,
  noiseSuppression: true,
  dropInMode: 'normal',
  hints: { maxBitrate: 32000, sampleRate: 48000, stereo: false, dtx: true },
};
const PRIVACY: PrivacySettings = {
  isPrivateAccount: false,
  allowWaves: true,
  isVisibleOnMap: false,
};

describe('ExtSettingsScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    mockAudioGet.mockResolvedValue(AUDIO);
    mockPrivacyGet.mockResolvedValue(PRIVACY);
    mockAudioUpdate.mockResolvedValue(AUDIO);
    mockPrivacyUpdate.mockResolvedValue(PRIVACY);
  });
  afterEach(() => {
    resetAuth();
    jest.clearAllMocks();
  });

  it('mounts (past the loader) and renders the settings sections', async () => {
    const { getByText } = renderScreen(<ExtSettingsScreen />, {});
    await waitFor(() => expect(getByText('Audio quality')).toBeTruthy());
    expect(getByText('Privacy')).toBeTruthy();
    expect(getByText('High')).toBeTruthy();
  });

  it('selecting an audio-quality tier calls audioApi.update', async () => {
    const { getByText } = renderScreen(<ExtSettingsScreen />, {});
    await waitFor(() => expect(getByText('Music')).toBeTruthy());
    fireEvent.press(getByText('Music'));
    await waitFor(() => expect(mockAudioUpdate).toHaveBeenCalledWith({ qualityTier: 'music' }));
  });

  it('toggling a privacy switch calls privacyApi.update', async () => {
    const { getByText, getAllByRole } = renderScreen(<ExtSettingsScreen />, {});
    await waitFor(() => expect(getByText('Private profile')).toBeTruthy());
    // The first Switch in the tree is "Spatial audio"; flip "Private profile"
    // by toggling its row switch via the accessible switch role list. We assert
    // the screen wires switches to the privacy/audio update calls without crash.
    const switches = getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    fireEvent(switches[switches.length - 1], 'valueChange', true);
    await waitFor(() => expect(mockPrivacyUpdate).toHaveBeenCalled());
  });
});
