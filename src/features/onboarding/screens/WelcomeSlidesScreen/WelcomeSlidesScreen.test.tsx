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
    const { getByText, toJSON } = renderScreen(<WelcomeSlidesScreen />, {
      route: { name: 'WelcomeSlides' },
    });
    expect(toJSON()).toBeTruthy();
    // First slide title (welcome) and the not-last CTA label.
    expect(getByText('Welcome to Chathouse')).toBeTruthy();
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
