import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useOnboardingStore } from '../../store/onboardingStore';
import { InterestSelectionScreen } from './InterestSelectionScreen';

// The screen only reads `setInterests` from the onboarding store via a
// selector. Mock the store so no real zustand state is touched and we can
// assert the persisted selection. The selector form is supported so the
// component's `useOnboardingStore(s => s.setInterests)` resolves correctly.
jest.mock('../../store/onboardingStore', () => {
  const setInterests = jest.fn();
  const state = { interests: [] as string[], setInterests };
  const useOnboardingStore = jest.fn((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
  return { useOnboardingStore };
});

const mockUseOnboardingStore = useOnboardingStore as unknown as jest.Mock;

// Pull the stable `setInterests` jest.fn back out of the mocked store so
// individual tests can assert against it.
const getSetInterests = (): jest.Mock =>
  mockUseOnboardingStore(
    (s: { setInterests: jest.Mock }) => s.setInterests,
  ) as unknown as jest.Mock;

describe('InterestSelectionScreen', () => {
  beforeEach(() => {
    getSetInterests().mockReset();
  });

  it('renders the title and min hint without crashing', () => {
    renderScreen(<InterestSelectionScreen />);
    expect(screen.getByText(i18n.t('onboarding.interests.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.interests.minHint'))).toBeTruthy();
  });

  it('renders a chip for every interest category', () => {
    renderScreen(<InterestSelectionScreen />);
    expect(screen.getByText(i18n.t('onboarding.interests.categories.tech'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.interests.categories.design'))).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.interests.categories.health'))).toBeTruthy();
  });

  it('does not navigate when fewer than three interests are selected', () => {
    const { navigation } = renderScreen(<InterestSelectionScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.tech')));
    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.finish')));

    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(getSetInterests()).not.toHaveBeenCalled();
  });

  it('shows the running count once at least three interests are selected', async () => {
    renderScreen(<InterestSelectionScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.tech')));
    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.design')));
    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.crypto')));

    expect(await screen.findByText('3 / 10')).toBeTruthy();
    expect(screen.queryByText(i18n.t('onboarding.interests.minHint'))).toBeNull();
  });

  it('toggling a selected chip off removes it from the count', async () => {
    renderScreen(<InterestSelectionScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.tech')));
    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.design')));
    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.crypto')));
    expect(await screen.findByText('3 / 10')).toBeTruthy();

    // Tap an already-selected chip to deselect it -> back below the minimum.
    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.crypto')));
    expect(await screen.findByText(i18n.t('onboarding.interests.minHint'))).toBeTruthy();
  });

  it('persists the selection and advances when Finish is pressed with enough interests', async () => {
    const { navigation } = renderScreen(<InterestSelectionScreen />);

    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.tech')));
    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.design')));
    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.categories.crypto')));

    fireEvent.press(screen.getByText(i18n.t('onboarding.interests.finish')));

    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('NotificationsPermission');
    });
    expect(getSetInterests()).toHaveBeenCalledWith(['tech', 'design', 'crypto']);
  });
});
