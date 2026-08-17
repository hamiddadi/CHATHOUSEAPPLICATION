import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { clubsListApi, type ClubLite } from '../api/clubsListApi';
import { ExtClubPickerSheet } from './ExtClubPickerSheet';

jest.mock('../api/clubsListApi', () => ({ clubsListApi: { myClubs: jest.fn() } }));

const mockMyClubs = clubsListApi.myClubs as jest.Mock;
const CLUB: ClubLite = {
  id: 'club-1',
  name: 'Design Club',
  iconUrl: null,
  privacy: 'OPEN',
  memberCount: 12,
};

describe('ExtClubPickerSheet', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the personal-room choice and explains an empty membership list', async () => {
    mockMyClubs.mockResolvedValue([]);
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const { getByLabelText, getByText } = render(
      <ExtClubPickerSheet visible onSelect={onSelect} onClose={onClose} />,
    );

    expect(await waitFor(() => getByText("You don't belong to any Club yet."))).toBeTruthy();
    fireEvent.press(getByLabelText('No Club (personal room)'));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable error instead of a false empty roster', async () => {
    mockMyClubs.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([CLUB]);
    const { getByLabelText, getByText } = render(
      <ExtClubPickerSheet visible onSelect={jest.fn()} onClose={jest.fn()} />,
    );

    expect(await waitFor(() => getByText("Couldn't load your Clubs."))).toBeTruthy();
    fireEvent.press(getByLabelText('Retry'));

    expect(await waitFor(() => getByLabelText('Design Club'))).toBeTruthy();
    expect(mockMyClubs).toHaveBeenCalledTimes(2);
  });
});
