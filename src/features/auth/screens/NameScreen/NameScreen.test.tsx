import React from 'react';
import { renderScreen, screen, fireEvent } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useOnboardingStore } from '../../../onboarding/store/onboardingStore';
import { NameScreen } from './NameScreen';

const setProfile = jest.fn();

// The store is selected via `useOnboardingStore(s => s.setProfile)`, so the mock
// must honour the selector argument and expose our spy.
jest.mock('../../../onboarding/store/onboardingStore', () => {
  const state = { setProfile: (...args: unknown[]) => setProfileImpl(...args) };
  const useOnboardingStoreMock = jest.fn((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state,
  );
  return { useOnboardingStore: useOnboardingStoreMock };
});

// Indirection so the jest.mock factory (hoisted) can reach the spy declared above.
const setProfileImpl = (...args: unknown[]) => setProfile(...args);

const PHONE = '+15555550123';

describe('NameScreen', () => {
  beforeEach(() => {
    setProfile.mockReset();
    (useOnboardingStore as unknown as jest.Mock).mockClear();
  });

  it('renders the heading and the name inputs', () => {
    renderScreen(<NameScreen />, { routeName: 'Name', routeParams: { phoneNumber: PHONE } });

    expect(screen.getByText(i18n.t('auth.name.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('auth.name.firstNameLabel'))).toBeTruthy();
    expect(screen.getByText(i18n.t('auth.name.lastNameLabel'))).toBeTruthy();
  });

  it('disables the submit button until a first name is entered', () => {
    renderScreen(<NameScreen />, { routeName: 'Name', routeParams: { phoneNumber: PHONE } });

    // Pressing while disabled is a no-op: the Button clears onPress when inactive.
    fireEvent.press(screen.getByText(i18n.t('auth.name.submit')));
    expect(setProfile).not.toHaveBeenCalled();
  });

  it('back button calls navigation.goBack', () => {
    const { navigation } = renderScreen(<NameScreen />, {
      routeName: 'Name',
      routeParams: { phoneNumber: PHONE },
    });

    fireEvent.press(screen.getByLabelText(i18n.t('common.close', 'Back')));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('stashes the trimmed profile and navigates to Username with the phone number', () => {
    const { navigation } = renderScreen(<NameScreen />, {
      routeName: 'Name',
      routeParams: { phoneNumber: PHONE },
    });

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('auth.name.firstNamePlaceholder')),
      '  Jane  ',
    );
    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('auth.name.lastNamePlaceholder')),
      'Doe',
    );

    fireEvent.press(screen.getByText(i18n.t('auth.name.submit')));

    expect(setProfile).toHaveBeenCalledWith({ firstName: 'Jane', lastName: 'Doe' });
    expect(navigation.navigate).toHaveBeenCalledWith('Username', { phoneNumber: PHONE });
  });

  it('passes undefined for an empty last name', () => {
    renderScreen(<NameScreen />, { routeName: 'Name', routeParams: { phoneNumber: PHONE } });

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('auth.name.firstNamePlaceholder')),
      'Jane',
    );
    fireEvent.press(screen.getByText(i18n.t('auth.name.submit')));

    expect(setProfile).toHaveBeenCalledWith({ firstName: 'Jane', lastName: undefined });
  });
});
