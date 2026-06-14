import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/authStore';
import { UsernameScreen } from './UsernameScreen';

// authService.suggestUsername() fires on mount (real impl hits the API). Mock
// the whole service so the screen mounts deterministically and we can drive the
// suggestion pills + assert setUsername is reached on submit.
jest.mock('../../services/authService', () => ({
  authService: {
    suggestUsername: jest.fn(),
    setUsername: jest.fn(),
  },
}));

const mockedService = authService as jest.Mocked<typeof authService>;

/**
 * UsernameScreen — no route params. Fetches 3 username suggestions on mount;
 * tapping a suggestion pill fills the input. The "Continue" CTA is disabled
 * until the username passes the zod schema (≥3 chars, [a-z0-9_]); submitting
 * calls store.setUsername.
 */
describe('UsernameScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    mockedService.suggestUsername.mockResolvedValue({ suggestions: [] });
  });
  afterEach(() => {
    resetAuth();
    jest.clearAllMocks();
  });

  it('mounts without throwing and shows the title', async () => {
    const { getByText, toJSON } = renderScreen(<UsernameScreen />);
    expect(toJSON()).toBeTruthy();
    expect(getByText('Pick a username')).toBeTruthy();
    // Let the on-mount suggestion fetch settle to avoid act warnings.
    await waitFor(() => expect(mockedService.suggestUsername).toHaveBeenCalled());
  });

  it('renders suggestion pills and fills the input when one is tapped', async () => {
    mockedService.suggestUsername.mockResolvedValue({
      suggestions: ['jane_doe', 'janed', 'jdoe'],
    });
    const { findByText, getByPlaceholderText } = renderScreen(<UsernameScreen />);

    const pill = await findByText('@jane_doe');
    fireEvent.press(pill);

    expect(getByPlaceholderText('jane_doe').props.value).toBe('jane_doe');
  });

  it('does not submit while the username is invalid (CTA disabled)', async () => {
    const setUsername = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ setUsername });
    const { getByText } = renderScreen(<UsernameScreen />);
    await waitFor(() => expect(mockedService.suggestUsername).toHaveBeenCalled());

    // Empty username → schema invalid → Button disabled → onPress is undefined.
    fireEvent.press(getByText('Continue'));
    expect(setUsername).not.toHaveBeenCalled();
  });

  it('calls store.setUsername with a valid handle on submit', async () => {
    const setUsername = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ setUsername });

    const { getByText, getByPlaceholderText } = renderScreen(<UsernameScreen />);
    await waitFor(() => expect(mockedService.suggestUsername).toHaveBeenCalled());

    fireEvent.changeText(getByPlaceholderText('jane_doe'), 'janedoe');

    // RHF revalidates async (mode: 'onChange'); the Button stays disabled (its
    // onPress is undefined) until isValid flips. Re-press inside waitFor so the
    // submit lands once validation has enabled it.
    await waitFor(() => {
      fireEvent.press(getByText('Continue'));
      expect(setUsername).toHaveBeenCalledWith('janedoe');
    });
  });
});
