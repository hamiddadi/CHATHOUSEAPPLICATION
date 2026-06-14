import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { useOnboardingStore } from '../../../onboarding/store/onboardingStore';
import { NameScreen } from './NameScreen';

const PHONE = '+14155551234';

/**
 * NameScreen — needs a `phoneNumber` route param. Back arrow → goBack. The
 * "Next" CTA is disabled until a first name is entered; pressing it stashes the
 * name in the onboarding store and navigates to 'Username' carrying phoneNumber.
 */
describe('NameScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    useOnboardingStore.getState().reset();
  });
  afterEach(() => {
    resetAuth();
    useOnboardingStore.getState().reset();
  });

  it('mounts without throwing and shows the title + inputs', () => {
    const { getByText, getByPlaceholderText, toJSON } = renderScreen(<NameScreen />, {
      route: { name: 'Name', params: { phoneNumber: PHONE } },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText("What's your name?")).toBeTruthy();
    expect(getByPlaceholderText('Jane')).toBeTruthy();
  });

  it('goes back when the header back button is pressed', () => {
    const { navigation, getByLabelText } = renderScreen(<NameScreen />, {
      route: { name: 'Name', params: { phoneNumber: PHONE } },
    });
    // Header back uses t('common.close', 'Back') — the 'common.close' key
    // exists in en.json ("Close"), so the inline 'Back' default is never used.
    fireEvent.press(getByLabelText('Close'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('does not navigate while the first name is empty (CTA disabled)', () => {
    const { navigation, getByText } = renderScreen(<NameScreen />, {
      route: { name: 'Name', params: { phoneNumber: PHONE } },
    });
    // Disabled Button has its onPress swapped to undefined, so this is a no-op.
    fireEvent.press(getByText('Next'));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('stashes the name and navigates to Username once a first name is entered', () => {
    const { navigation, getByText, getByPlaceholderText } = renderScreen(<NameScreen />, {
      route: { name: 'Name', params: { phoneNumber: PHONE } },
    });
    fireEvent.changeText(getByPlaceholderText('Jane'), 'Jane');
    fireEvent.changeText(getByPlaceholderText('Doe'), 'Doe');
    fireEvent.press(getByText('Next'));

    expect(navigation.navigate).toHaveBeenCalledWith('Username', { phoneNumber: PHONE });
    const store = useOnboardingStore.getState();
    expect(store.firstName).toBe('Jane');
    expect(store.lastName).toBe('Doe');
  });
});
