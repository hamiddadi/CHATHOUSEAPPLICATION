/**
 * Render-test for ExtPlaygroundScreen — the developer QA surface that renders
 * every extension component in isolation. We only assert it mounts crash-free
 * (its child strips fetch live data that fails gracefully offline) and that its
 * local-state CTAs (open share sheet / reaction picker) are pressable. Native
 * modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { ExtPlaygroundScreen } from './ExtPlaygroundScreen';

describe('ExtPlaygroundScreen', () => {
  beforeEach(() => mockAuthenticated());
  afterEach(() => resetAuth());

  it('mounts without crashing and shows the playground title', () => {
    const { getByText, toJSON } = renderScreen(<ExtPlaygroundScreen />, {});
    expect(toJSON()).toBeTruthy();
    expect(getByText('Extensions Playground')).toBeTruthy();
  });

  it('the "Open share sheet" and "Open reaction picker" CTAs are pressable', () => {
    const { getByLabelText } = renderScreen(<ExtPlaygroundScreen />, {});
    expect(() => fireEvent.press(getByLabelText('Open share sheet'))).not.toThrow();
    expect(() => fireEvent.press(getByLabelText('Open reaction picker'))).not.toThrow();
  });

  it('the social deep-link buttons are pressable without throwing', () => {
    const { getByLabelText } = renderScreen(<ExtPlaygroundScreen />, {});
    expect(() => fireEvent.press(getByLabelText('Open @clubhouse on Twitter'))).not.toThrow();
  });
});
