/**
 * Render + interaction tests for WelcomeSlidesScreen (onboarding step 0, the
 * pre-auth pedagogical carousel). Verifies it mounts, the Skip button finishes
 * the flow (markSeen + replace -> Landing), and the primary Next/Get-started
 * button advances through slides and finishes on the last one.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { WelcomeSlidesScreen } from './WelcomeSlidesScreen';

describe('WelcomeSlidesScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    jest.clearAllMocks();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts without throwing and shows the first slide + the Next CTA', () => {
    const { getByTestId, getByText, toJSON } = renderScreen(<WelcomeSlidesScreen />, {
      route: { name: 'WelcomeSlides' },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByTestId('welcome-slides-screen')).toBeTruthy();
    expect(getByTestId('welcome-slide-welcome')).toBeTruthy();
    expect(getByTestId('welcome-progress-1-of-4')).toBeTruthy();
    // First slide title (welcome) and the not-last CTA label.
    expect(getByText('Welcome to ChatHouse')).toBeTruthy();
    expect(getByText('Next')).toBeTruthy();
    // Skip is visible while not on the last slide.
    expect(getByText('Skip')).toBeTruthy();
  });

  it('Skip marks the carousel seen and replaces to Landing', async () => {
    const { getByText, navigation } = renderScreen(<WelcomeSlidesScreen />, {
      route: { name: 'WelcomeSlides' },
    });
    fireEvent.press(getByText('Skip'));
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('Landing');
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('chathouse.welcomeSlides.completed.v1', '1');
  });

  it('a double-tap on Skip only finishes the flow once', async () => {
    const { getByText, navigation } = renderScreen(<WelcomeSlidesScreen />, {
      route: { name: 'WelcomeSlides' },
    });
    const skip = getByText('Skip');
    // Two rapid taps before the async markSeen resolves: the latch must make
    // the second one a no-op so `replace` fires exactly once.
    fireEvent.press(skip);
    fireEvent.press(skip);
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('Landing');
    });
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it('announces the slide progress to screen readers and updates it on Next', async () => {
    const { getByLabelText, getByTestId, getByText } = renderScreen(<WelcomeSlidesScreen />, {
      route: { name: 'WelcomeSlides' },
    });
    // The progress dots are exposed as a single "slide x of y" announcement.
    expect(getByLabelText('Slide 1 of 4')).toBeTruthy();
    fireEvent.press(getByText('Next'));
    await waitFor(() => {
      expect(getByLabelText('Slide 2 of 4')).toBeTruthy();
      expect(getByTestId('welcome-progress-2-of-4')).toBeTruthy();
    });
  });

  it('Next advances slides and the final Get-started finishes the flow', async () => {
    const { getByText, navigation } = renderScreen(<WelcomeSlidesScreen />, {
      route: { name: 'WelcomeSlides' },
    });
    // 4 slides => press Next 3 times to reach the last (label becomes "Get started").
    fireEvent.press(getByText('Next'));
    fireEvent.press(getByText('Next'));
    fireEvent.press(getByText('Next'));
    // On the last slide the CTA label changes and Skip is hidden.
    const start = await waitFor(() => getByText('Get started'));
    expect(navigation.replace).not.toHaveBeenCalled();
    fireEvent.press(start);
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('Landing');
    });
  });
});
