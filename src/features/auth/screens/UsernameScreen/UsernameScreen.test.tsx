import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/authStore';
import { UsernameScreen } from './UsernameScreen';

jest.mock('../../services/authService', () => ({
  authService: {
    suggestUsername: jest.fn(),
    setUsername: jest.fn(),
  },
}));

jest.mock('../../store/authStore', () => ({
  useAuthStore: jest.fn(),
}));

const mockSuggestUsername = authService.suggestUsername as jest.Mock;
const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

const setUsernameAction = jest.fn().mockResolvedValue(undefined);

const storeState = { setUsername: setUsernameAction };

beforeEach(() => {
  mockSuggestUsername.mockReset();
  setUsernameAction.mockReset();
  setUsernameAction.mockResolvedValue(undefined);
  // Support the selector usage `useAuthStore(s => s.setUsername)`.
  mockUseAuthStore.mockImplementation((selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState,
  );
});

describe('UsernameScreen', () => {
  it('renders the title and submit button without crashing', async () => {
    mockSuggestUsername.mockResolvedValue({ suggestions: [] });
    renderScreen(<UsernameScreen />);

    expect(screen.getByText(i18n.t('auth.username.title'))).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('auth.username.submit') })).toBeTruthy();

    // Let the mount effect settle so no act() warning leaks.
    await waitFor(() => expect(mockSuggestUsername).toHaveBeenCalled());
  });

  it('shows a loading indicator while suggestions are being fetched', async () => {
    let resolveFn: (value: { suggestions: string[] }) => void = () => undefined;
    mockSuggestUsername.mockReturnValue(
      new Promise<{ suggestions: string[] }>(resolve => {
        resolveFn = resolve;
      }),
    );

    renderScreen(<UsernameScreen />);

    // Title still renders while suggestions load, and no pills are shown yet.
    expect(screen.getByText(i18n.t('auth.username.title'))).toBeTruthy();
    expect(screen.queryByText('@jane_doe')).toBeNull();

    resolveFn({ suggestions: [] });
    await waitFor(() => expect(mockSuggestUsername).toHaveBeenCalled());
  });

  it('renders up to three suggestion pills once loaded', async () => {
    mockSuggestUsername.mockResolvedValue({
      suggestions: ['jane_doe', 'jdoe', 'janed', 'extra_one'],
    });

    renderScreen(<UsernameScreen />);

    expect(await screen.findByText('@jane_doe')).toBeTruthy();
    expect(screen.getByText('@jdoe')).toBeTruthy();
    expect(screen.getByText('@janed')).toBeTruthy();
    // Only the first three are kept.
    expect(screen.queryByText('@extra_one')).toBeNull();
  });

  it('fills the input when a suggestion pill is pressed', async () => {
    mockSuggestUsername.mockResolvedValue({ suggestions: ['jane_doe'] });

    renderScreen(<UsernameScreen />);

    fireEvent.press(await screen.findByText('@jane_doe'));

    // Picking a valid suggestion populates the field and enables the CTA.
    expect(await screen.findByDisplayValue('jane_doe')).toBeTruthy();
  });

  it('calls setUsername with the entered handle on submit', async () => {
    mockSuggestUsername.mockResolvedValue({ suggestions: [] });

    renderScreen(<UsernameScreen />);

    const input = await screen.findByPlaceholderText(i18n.t('auth.username.placeholder'));
    fireEvent.changeText(input, 'jane_doe');

    const submit = screen.getByRole('button', { name: i18n.t('auth.username.submit') });
    // The CTA is disabled until the form validates onChange.
    await waitFor(() => expect(submit.props.accessibilityState?.disabled).toBe(false));
    fireEvent.press(submit);

    await waitFor(() => expect(setUsernameAction).toHaveBeenCalledWith('jane_doe'));
  });

  it('does not submit when the username is invalid (too short)', async () => {
    mockSuggestUsername.mockResolvedValue({ suggestions: [] });

    renderScreen(<UsernameScreen />);

    const input = await screen.findByPlaceholderText(i18n.t('auth.username.placeholder'));
    fireEvent.changeText(input, 'ab');

    const submit = screen.getByRole('button', { name: i18n.t('auth.username.submit') });
    fireEvent.press(submit);

    await waitFor(() =>
      expect(screen.getByText(i18n.t('auth.username.errors.tooShort'))).toBeTruthy(),
    );
    expect(setUsernameAction).not.toHaveBeenCalled();
  });
});
