import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useCreateHouse } from '../../hooks/useHouses';
import { mediaService } from '../../../../shared/services/api/mediaService';
import { CreateHouseScreen } from './CreateHouseScreen';

// Keep the real query-key factory and sibling hooks; only override the mutation
// hook the screen consumes so no real network/react-query work happens.
jest.mock('../../hooks/useHouses', () => {
  const actual = jest.requireActual('../../hooks/useHouses');
  return { ...actual, useCreateHouse: jest.fn() };
});

// `uploadAvatar` only fires when an icon is picked, but mock it so the real
// apiClient/network is never reached even if a test exercises that path.
jest.mock('../../../../shared/services/api/mediaService', () => ({
  mediaService: { uploadAvatar: jest.fn().mockResolvedValue('https://cdn.example/icon.jpg') },
}));

const mockUseCreateHouse = useCreateHouse as unknown as jest.Mock;
const mockUploadAvatar = mediaService.uploadAvatar as jest.Mock;

type MutationOverrides = {
  mutateAsync?: jest.Mock;
  isPending?: boolean;
};

const mutationState = (over: MutationOverrides = {}) => ({
  mutate: jest.fn(),
  mutateAsync: over.mutateAsync ?? jest.fn().mockResolvedValue(undefined),
  isPending: over.isPending ?? false,
  isError: false,
  error: null,
  reset: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseCreateHouse.mockReturnValue(mutationState());
});

describe('CreateHouseScreen', () => {
  it('renders the title, form fields and privacy options', () => {
    renderScreen(<CreateHouseScreen />);

    // `houses.create.title` exists in the EN locale -> resolves to the translation.
    // It appears both as the header and the submit button label, so match >= 1.
    expect(screen.getAllByText(i18n.t('houses.create.title')).length).toBeGreaterThan(0);
    // Name counter starts empty.
    expect(screen.getByText('0 / 30')).toBeTruthy();
    expect(screen.getByText('0 / 200')).toBeTruthy();
    // Privacy rows expose their option as an accessible radio.
    expect(
      screen.getByRole('radio', { name: 'Open: Anyone can join and start rooms' }),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Private: Invitation only' })).toBeTruthy();
  });

  it('exposes the icon-upload affordance and close control', () => {
    renderScreen(<CreateHouseScreen />);

    expect(screen.getByLabelText('Upload house icon')).toBeTruthy();
    expect(screen.getByLabelText('Close without creating')).toBeTruthy();
  });

  it('updates the name character counter as the user types', () => {
    renderScreen(<CreateHouseScreen />);

    const nameInput = screen.getByPlaceholderText(i18n.t('houses.create.namePlaceholder'));
    fireEvent.changeText(nameInput, 'Indie');

    expect(screen.getByText('5 / 30')).toBeTruthy();
  });

  it('goes back when the close control is pressed', () => {
    const { navigation } = renderScreen(<CreateHouseScreen />);

    fireEvent.press(screen.getByLabelText('Close without creating'));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('creates the house and navigates back when submitted with a valid name', async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseCreateHouse.mockReturnValue(mutationState({ mutateAsync }));

    const { navigation } = renderScreen(<CreateHouseScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('houses.create.namePlaceholder')),
      'Indie Hackers',
    );
    // The submit button label falls back to its inline English default.
    fireEvent.press(screen.getByRole('button', { name: 'Create House' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Indie Hackers',
          privacy: 'open',
          iconUrl: undefined,
        }),
      );
    });
    // No icon picked -> no upload attempted.
    expect(mockUploadAvatar).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('does not submit when the name is too short', () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseCreateHouse.mockReturnValue(mutationState({ mutateAsync }));

    const { navigation } = renderScreen(<CreateHouseScreen />);

    fireEvent.changeText(screen.getByPlaceholderText(i18n.t('houses.create.namePlaceholder')), 'a');
    fireEvent.press(screen.getByRole('button', { name: 'Create House' }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
