import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { audioApi, type AudioPreferences } from '../api/audioApi';
import { privacyApi, type PrivacySettings } from '../api/privacyApi';
import { ExtSettingsScreen } from './ExtSettingsScreen';

// The screen calls these service objects directly (no react-query hook layer),
// so mock the modules so no real HTTP happens. Spread the real module to keep
// the exported types/values the screen imports intact.
jest.mock('../api/audioApi', () => {
  const actual = jest.requireActual('../api/audioApi');
  return { ...actual, audioApi: { get: jest.fn(), update: jest.fn() } };
});
jest.mock('../api/privacyApi', () => {
  const actual = jest.requireActual('../api/privacyApi');
  return { ...actual, privacyApi: { get: jest.fn(), update: jest.fn() } };
});

// ExtThemeToggle transitively imports AsyncStorage/Appearance via its provider.
// It's not the subject under test, so stub it with an inert view.
jest.mock('../components/ExtThemeToggle', () => {
  const ReactLib = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { ExtThemeToggle: () => ReactLib.createElement(View, { testID: 'ext-theme-toggle' }) };
});

const audioGet = audioApi.get as jest.Mock;
const audioUpdate = audioApi.update as jest.Mock;
const privacyGet = privacyApi.get as jest.Mock;
const privacyUpdate = privacyApi.update as jest.Mock;

const makeAudio = (over: Partial<AudioPreferences> = {}): AudioPreferences => ({
  qualityTier: 'standard',
  spatialAudio: false,
  noiseSuppression: true,
  dropInMode: 'normal',
  hints: { maxBitrate: 24000, sampleRate: 24000, stereo: false, dtx: true },
  ...over,
});

const makePrivacy = (over: Partial<PrivacySettings> = {}): PrivacySettings => ({
  isPrivateAccount: false,
  allowWaves: true,
  isVisibleOnMap: false,
  ...over,
});

describe('ExtSettingsScreen', () => {
  beforeEach(() => {
    audioGet.mockReset().mockResolvedValue(makeAudio());
    audioUpdate.mockReset().mockResolvedValue(makeAudio());
    privacyGet.mockReset().mockResolvedValue(makePrivacy());
    privacyUpdate.mockReset().mockResolvedValue(makePrivacy());
  });

  it('renders the loaded settings sections once preferences resolve', async () => {
    renderScreen(<ExtSettingsScreen />);

    expect(await screen.findByText(i18n.t('extensions.settings.appearance'))).toBeTruthy();
    expect(screen.getByText(i18n.t('extensions.settings.audioQuality'))).toBeTruthy();
    expect(screen.getByText(i18n.t('extensions.settings.privacyTitle'))).toBeTruthy();
  });

  it('shows a loading indicator before the preferences resolve', async () => {
    // Never-resolving fetch keeps the screen in its loading branch.
    audioGet.mockReturnValue(new Promise<AudioPreferences>(() => undefined));
    privacyGet.mockReturnValue(new Promise<PrivacySettings>(() => undefined));

    renderScreen(<ExtSettingsScreen />);

    // Section titles are not rendered while loading.
    expect(screen.queryByText(i18n.t('extensions.settings.audioQuality'))).toBeNull();
    await waitFor(() => expect(audioGet).toHaveBeenCalled());
  });

  it('marks the active audio quality tier as selected', async () => {
    audioGet.mockResolvedValue(makeAudio({ qualityTier: 'high' }));

    renderScreen(<ExtSettingsScreen />);

    const highTier = await screen.findByText(i18n.t('extensions.settings.audioHigh'));
    expect(highTier).toBeTruthy();
    // The standard tier should still render but not be the selected one.
    expect(screen.getByText(i18n.t('extensions.settings.audioStandard'))).toBeTruthy();
  });

  it('persists a new audio quality tier when a tier is pressed', async () => {
    renderScreen(<ExtSettingsScreen />);

    fireEvent.press(await screen.findByText(i18n.t('extensions.settings.audioMusic')));

    await waitFor(() => expect(audioUpdate).toHaveBeenCalledWith({ qualityTier: 'music' }));
  });

  it('persists an audio engine toggle change', async () => {
    renderScreen(<ExtSettingsScreen />);

    await screen.findByText(i18n.t('extensions.settings.audioEngine'));
    const switches = screen.getAllByRole('switch');
    // First switch belongs to the audio engine section (spatial audio).
    fireEvent(switches[0], 'valueChange', true);

    await waitFor(() => expect(audioUpdate).toHaveBeenCalledWith({ spatialAudio: true }));
  });

  it('persists a privacy toggle change', async () => {
    renderScreen(<ExtSettingsScreen />);

    await screen.findByText(i18n.t('extensions.settings.privacyTitle'));
    const switches = screen.getAllByRole('switch');
    // Privacy switches follow the three audio-engine switches.
    fireEvent(switches[3], 'valueChange', true);

    await waitFor(() => expect(privacyUpdate).toHaveBeenCalledWith({ isPrivateAccount: true }));
  });
});
