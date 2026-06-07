import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { welcomeStorage } from '../../services/welcomeStorage';
import { WelcomeSlidesScreen } from './WelcomeSlidesScreen';

// Keep AsyncStorage out of the test: stub the storage service the screen
// imports. markSeen resolves so goLanding's `await` continues to navigation.
jest.mock('../../services/welcomeStorage', () => ({
  welcomeStorage: {
    markSeen: jest.fn().mockResolvedValue(undefined),
    hasSeen: jest.fn().mockResolvedValue(false),
    reset: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockMarkSeen = welcomeStorage.markSeen as jest.Mock;

// Advances the carousel by pressing the action button `times` times. Each press
// before the last slide re-labels the button from "Next" to itself; the final
// slide flips it to "Get started".
const pressNext = (times: number): void => {
  for (let i = 0; i < times; i += 1) {
    fireEvent.press(screen.getByText(i18n.t('onboarding.welcome.next')));
  }
};

describe('WelcomeSlidesScreen', () => {
  beforeEach(() => {
    mockMarkSeen.mockClear();
  });

  it('renders the first slide with Skip and Next actions', () => {
    renderScreen(<WelcomeSlidesScreen />);

    expect(screen.getByText(i18n.t('onboarding.welcome.skip'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.welcome.next'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.welcome.slides.welcome.title'))).toBeTruthy();
  });

  it('pressing Skip marks the carousel seen and replaces to Landing', async () => {
    const { navigation } = renderScreen(<WelcomeSlidesScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.welcome.skip')));

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('Landing');
    });
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  });

  it('advancing to the last slide swaps the action label and hides Skip', () => {
    renderScreen(<WelcomeSlidesScreen />);

    // 3 presses move index 0 -> 3 (the last of 4 slides).
    pressNext(3);

    expect(screen.getByText(i18n.t('onboarding.welcome.start'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('onboarding.welcome.next'))).toBeNull();
    expect(screen.queryByText(i18n.t('onboarding.welcome.skip'))).toBeNull();
  });

  it('pressing Get started on the last slide finishes the flow', async () => {
    const { navigation } = renderScreen(<WelcomeSlidesScreen />);

    pressNext(3);
    fireEvent.press(screen.getByText(i18n.t('onboarding.welcome.start')));

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('Landing');
    });
    expect(mockMarkSeen).toHaveBeenCalledTimes(1);
  });

  it('does not finish the flow while on an intermediate slide', () => {
    const { navigation } = renderScreen(<WelcomeSlidesScreen />);

    pressNext(1);

    expect(navigation.replace).not.toHaveBeenCalled();
    expect(mockMarkSeen).not.toHaveBeenCalled();
    expect(screen.getByText(i18n.t('onboarding.welcome.next'))).toBeTruthy();
  });
});
