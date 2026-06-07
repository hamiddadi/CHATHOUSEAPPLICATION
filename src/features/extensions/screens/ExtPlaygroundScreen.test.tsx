import React from 'react';
import { renderScreen, screen, fireEvent } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useExtFontScale } from '../hooks/useExtFontScale';
import { useExtWave } from '../hooks/useExtWave';
import { ExtPlaygroundScreen } from './ExtPlaygroundScreen';

// AsyncStorage (pulled in transitively via ExtThemeProvider) is mocked globally
// in jest-setup.ts, so no local mock is needed here.

// Accessibility / font-scale hook: pin to a deterministic value and drop the
// real setInterval polling so the screen renders a stable "× 1.00".
jest.mock('../hooks/useExtFontScale', () => ({ useExtFontScale: jest.fn(() => 1) }));

// Wave hook: drive its returned state per-test (idle / sending).
jest.mock('../hooks/useExtWave', () => ({ useExtWave: jest.fn() }));

// People / upcoming strips fetch via react-query — return empty, settled state
// so they render null / the empty hint instead of touching the network.
jest.mock('../hooks/usePresence', () => ({
  useExtAvailablePeople: jest.fn(() => ({ data: [], isLoading: false })),
}));
jest.mock('../hooks/useUpcoming', () => ({
  useExtUpcoming: jest.fn(() => ({ data: [], isLoading: false })),
}));

// Badges row fetches from apiClient on mount; the inert axios mock would resolve
// to `undefined` and crash on `items.length`. Keep BADGE_META real, stub list().
jest.mock('../api/badgesApi', () => {
  const actual = jest.requireActual('../api/badgesApi');
  return { ...actual, badgesApi: { list: jest.fn().mockResolvedValue([]) } };
});

const mockUseExtFontScale = useExtFontScale as jest.Mock;
const mockUseExtWave = useExtWave as jest.Mock;

const waveState = (over: Partial<ReturnType<typeof useExtWave>> = {}) => ({
  wave: jest.fn().mockResolvedValue(true),
  pending: null,
  lastResult: null,
  ...over,
});

describe('ExtPlaygroundScreen', () => {
  beforeEach(() => {
    mockUseExtFontScale.mockReturnValue(1);
    mockUseExtWave.mockReturnValue(waveState());
  });

  it('renders without crashing and shows the title', () => {
    renderScreen(<ExtPlaygroundScreen />);
    expect(screen.getByText(i18n.t('extensions.playground.title'))).toBeTruthy();
  });

  it('shows the idle wave status when no wave has been sent', () => {
    mockUseExtWave.mockReturnValue(waveState({ lastResult: null, pending: null }));
    renderScreen(<ExtPlaygroundScreen />);
    // The status renders as one concatenated <Text>: "Wave status: idle".
    const label = i18n.t('extensions.playground.waveStatus');
    expect(screen.getByText(`${label}: ${i18n.t('extensions.playground.idle')}`)).toBeTruthy();
  });

  it('reflects the sending state while a wave is pending', () => {
    mockUseExtWave.mockReturnValue(waveState({ pending: 'user-1' }));
    renderScreen(<ExtPlaygroundScreen />);
    const label = i18n.t('extensions.playground.waveStatus');
    expect(screen.getByText(`${label}: ${i18n.t('extensions.playground.waving')}`)).toBeTruthy();
  });

  it('marks the default interests input as valid', () => {
    renderScreen(<ExtPlaygroundScreen />);
    // Default value "tech, music, startups" => 3 unique interests => valid.
    expect(screen.getByText(i18n.t('extensions.playground.interestsValid'))).toBeTruthy();
  });

  it('flags too few interests after the input is reduced', () => {
    renderScreen(<ExtPlaygroundScreen />);
    const input = screen.getByDisplayValue('tech, music, startups');
    fireEvent.changeText(input, 'tech');
    // validateInterests => too_few => "(need <n> more)" surfaces in one Text node.
    // RNTL getByText only accepts string | RegExp (no function matcher).
    const need = i18n.t('extensions.playground.interestsNeed');
    const more = i18n.t('extensions.playground.interestsMore');
    // need/more come from bundled i18n (trusted, not user input).
    // eslint-disable-next-line security/detect-non-literal-regexp
    expect(screen.getByText(new RegExp(`${need}\\s+\\d+\\s+${more}`))).toBeTruthy();
    expect(screen.queryByText(i18n.t('extensions.playground.interestsValid'))).toBeNull();
  });

  it('opens the reaction picker when its button is pressed', async () => {
    renderScreen(<ExtPlaygroundScreen />);
    fireEvent.press(screen.getByLabelText(i18n.t('extensions.playground.openReactionPicker')));
    expect(await screen.findByLabelText('React with ❤️')).toBeTruthy();
  });
});
