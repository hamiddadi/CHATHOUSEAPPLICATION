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

// Cold-start headroom: the first render pays the module-graph transform cost (a
// known Windows-jest flake), so give async assertions more than the 1s default.
jest.setTimeout(20000);
const WAIT = { timeout: 8000 } as const;

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
    await waitFor(() => expect(getByText('Audio quality')).toBeTruthy(), WAIT);
    expect(getByText('Privacy')).toBeTruthy();
    expect(getByText('High')).toBeTruthy();
  });

  it('selecting an audio-quality tier calls audioApi.update', async () => {
    const { getByText } = renderScreen(<ExtSettingsScreen />, {});
    await waitFor(() => expect(getByText('Music')).toBeTruthy(), WAIT);
    fireEvent.press(getByText('Music'));
    await waitFor(
      () => expect(mockAudioUpdate).toHaveBeenCalledWith({ qualityTier: 'music' }),
      WAIT,
    );
  });

  it('toggling a privacy switch calls privacyApi.update', async () => {
    const { getByLabelText, getByText } = renderScreen(<ExtSettingsScreen />, {});
    await waitFor(() => expect(getByText('Private profile')).toBeTruthy(), WAIT);
    fireEvent(getByLabelText('Private profile'), 'valueChange', true);
    await waitFor(() => expect(mockPrivacyUpdate).toHaveBeenCalled(), WAIT);
  });

  it('shows an error state with a working Retry when the initial load fails', async () => {
    mockAudioGet.mockRejectedValueOnce(new Error('offline'));
    const { getByText, getByLabelText } = renderScreen(<ExtSettingsScreen />, {});
    // Load failed → error copy + retry, not the silently-defaulted settings.
    await waitFor(() => expect(getByText("Couldn't load your settings.")).toBeTruthy(), WAIT);
    // Retry re-runs the load; this time both APIs resolve.
    fireEvent.press(getByLabelText('Retry'));
    await waitFor(() => expect(getByText('Audio quality')).toBeTruthy(), WAIT);
  });

  it('no longer renders the (decorative) light/auto theme toggle', async () => {
    const { getByText, queryByText } = renderScreen(<ExtSettingsScreen />, {});
    await waitFor(() => expect(getByText('Audio quality')).toBeTruthy(), WAIT);
    // The former three-segment auto/light/dark switch is gone (mono-dark app).
    expect(queryByText('Appearance')).toBeNull();
    expect(queryByText('Auto')).toBeNull();
    expect(queryByText('Light')).toBeNull();
  });
});
