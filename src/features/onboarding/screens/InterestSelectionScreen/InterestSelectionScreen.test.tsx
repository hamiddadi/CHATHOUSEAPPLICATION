/**
 * Render + interaction tests for InterestSelectionScreen (onboarding step 2).
 * Verifies it mounts, the Finish CTA is gated until >= 3 interests are picked,
 * and once enabled it persists the selection to the onboarding store and
 * navigates to NotificationsPermission.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { useOnboardingStore } from '../../store/onboardingStore';
import { InterestSelectionScreen } from './InterestSelectionScreen';

describe('InterestSelectionScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    useOnboardingStore.getState().reset();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts without throwing and shows the title, hint and all category chips', () => {
    const { getByText, toJSON } = renderScreen(<InterestSelectionScreen />, {
      route: { name: 'InterestSelection' },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Pick a few interests')).toBeTruthy();
    expect(getByText('Pick at least 3.')).toBeTruthy();
    // A couple of the rendered chips.
    expect(getByText('Tech')).toBeTruthy();
    expect(getByText('Music')).toBeTruthy();
    expect(getByText('Finish')).toBeTruthy();
  });

  it('Finish is a no-op while fewer than 3 interests are selected', () => {
    const { getByText, navigation } = renderScreen(<InterestSelectionScreen />, {
      route: { name: 'InterestSelection' },
    });
    // Select only 2 chips -> below the minimum.
    fireEvent.press(getByText('Tech'));
    fireEvent.press(getByText('Design'));
    fireEvent.press(getByText('Finish'));
    // Disabled Button passes onPress=undefined; the guard in onFinish also returns.
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().interests).toEqual([]);
  });

  it('Finish persists the selection and navigates once >= 3 chips are picked', () => {
    const { getByText, navigation } = renderScreen(<InterestSelectionScreen />, {
      route: { name: 'InterestSelection' },
    });
    fireEvent.press(getByText('Tech'));
    fireEvent.press(getByText('Design'));
    fireEvent.press(getByText('Crypto'));
    fireEvent.press(getByText('Finish'));
    expect(navigation.navigate).toHaveBeenCalledWith('NotificationsPermission');
    expect(useOnboardingStore.getState().interests).toEqual(['tech', 'design', 'crypto']);
  });

  it('toggling a chip off removes it from the selection', () => {
    const { getByText, navigation } = renderScreen(<InterestSelectionScreen />, {
      route: { name: 'InterestSelection' },
    });
    fireEvent.press(getByText('Tech'));
    fireEvent.press(getByText('Design'));
    fireEvent.press(getByText('Crypto'));
    // Deselect Design -> back under the minimum so Finish is a no-op again.
    fireEvent.press(getByText('Design'));
    fireEvent.press(getByText('Finish'));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('rehydrates a previously-stored selection so Finish works without re-picking', () => {
    // Simulate coming back to this screen after a prior pass stored 3 interests.
    useOnboardingStore.getState().setInterests(['tech', 'design', 'crypto']);
    const { getByText, navigation } = renderScreen(<InterestSelectionScreen />, {
      route: { name: 'InterestSelection' },
    });
    // Counter reflects the rehydrated selection against the EFFECTIVE max (7
    // categories, not the raw backend cap of 10).
    expect(getByText('3 / 7')).toBeTruthy();
    fireEvent.press(getByText('Finish'));
    expect(navigation.navigate).toHaveBeenCalledWith('NotificationsPermission');
    expect(useOnboardingStore.getState().interests).toEqual(['tech', 'design', 'crypto']);
  });

  it('shows the max hint once every reachable chip is selected (cap = category count)', () => {
    const { getByText } = renderScreen(<InterestSelectionScreen />, {
      route: { name: 'InterestSelection' },
    });
    for (const label of ['Tech', 'Design', 'Crypto', 'AI', 'Music', 'Business', 'Health']) {
      fireEvent.press(getByText(label));
    }
    // Counter caps at 7 (the number of categories) and the hint is appended.
    expect(getByText(/7 \/ 7/)).toBeTruthy();
    expect(getByText(/You can pick up to 7\./)).toBeTruthy();
  });

  it('the back chevron pops back to the previous onboarding step', () => {
    const { getByLabelText, navigation } = renderScreen(<InterestSelectionScreen />, {
      route: { name: 'InterestSelection' },
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
