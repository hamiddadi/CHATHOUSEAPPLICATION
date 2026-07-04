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
    // Header back is labelled t('common.back', 'Back') — resolves to "Back"
    // from en.json (audit fix: was mislabelled with the 'common.close' key).
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('strips Unicode control/format characters from the name inputs', () => {
    const { getByText, getByPlaceholderText } = renderScreen(<NameScreen />, {
      route: { name: 'Name', params: { phoneNumber: PHONE } },
    });
    // BEL (Cc, U+0007), RTL-override (Cf, U+202E) and zero-width space
    // (Cf, U+200B) must be filtered; visible letters pass through untouched.
    // Built via fromCharCode so no invisible/bidi literal sits in the source.
    const BEL = String.fromCharCode(0x07);
    const RLO = String.fromCharCode(0x202e);
    const ZWSP = String.fromCharCode(0x200b);
    fireEvent.changeText(getByPlaceholderText('Jane'), `Ja${BEL}ne${RLO}`);
    expect(getByPlaceholderText('Jane').props.value).toBe('Jane');

    fireEvent.changeText(getByPlaceholderText('Doe'), `D${ZWSP}oe`);
    expect(getByPlaceholderText('Doe').props.value).toBe('Doe');

    fireEvent.press(getByText('Next'));
    const store = useOnboardingStore.getState();
    expect(store.firstName).toBe('Jane');
    expect(store.lastName).toBe('Doe');
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
