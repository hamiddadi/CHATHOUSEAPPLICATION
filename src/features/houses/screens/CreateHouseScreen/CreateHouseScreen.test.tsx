/**
 * CreateHouseScreen render + button tests. The screen is form-driven (no remote
 * query gating mount), so it renders immediately. We exercise: the close
 * button (goBack), the icon picker (react-native-image-picker is globally
 * mocked), the privacy radio options, and the Create CTA — which is disabled
 * until the name is >= 2 chars, so we type one first and assert the press is
 * crash-free (the create mutation fires against the unmocked api → resolves or
 * rejects asynchronously, which the screen handles).
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { CreateHouseScreen } from './CreateHouseScreen';

describe('CreateHouseScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts and shows its title + Create CTA', () => {
    const { toJSON, getAllByText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    expect(toJSON()).toBeTruthy();
    // i18n en.json: houses.create.title === 'Create House'; the submit button
    // label (houses.create.submitBtn) is absent → falls back to its inline
    // default 'Create House' too, so the text appears twice (header + CTA).
    expect(getAllByText('Create House').length).toBeGreaterThanOrEqual(2);
  });

  it('close button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    fireEvent.press(getByLabelText('Close without creating'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('icon picker button is pressable without crashing', () => {
    const { getByLabelText, toJSON } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    fireEvent.press(getByLabelText('Upload house icon'));
    expect(toJSON()).toBeTruthy();
  });

  it('selecting a privacy option toggles its selected state', () => {
    const { getByLabelText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    const privateRow = getByLabelText('Private: Invitation only');
    fireEvent.press(privateRow);
    expect(privateRow.props.accessibilityState.selected).toBe(true);
  });

  it('Create CTA fires (after a valid name) without crashing', () => {
    const { getAllByText, getByPlaceholderText, toJSON } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    // i18n en.json: houses.create.namePlaceholder === 'House Name'.
    fireEvent.changeText(getByPlaceholderText('House Name'), 'My House');
    // 'Create House' renders twice (header + CTA); the button is the last one.
    const matches = getAllByText('Create House');
    fireEvent.press(matches[matches.length - 1]);
    expect(toJSON()).toBeTruthy();
  });
});
