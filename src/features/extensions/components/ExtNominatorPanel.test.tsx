import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { nominatorApi } from '../api/nominatorApi';
import { ExtNominatorPanel } from './ExtNominatorPanel';

jest.mock('../api/nominatorApi', () => ({
  nominatorApi: { me: jest.fn(), invite: jest.fn() },
}));

const mockMe = nominatorApi.me as jest.Mock;

describe('ExtNominatorPanel', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('names both invite fields after loading', async () => {
    mockMe.mockResolvedValue({ remaining: 2, history: [] });
    const { getByLabelText } = render(<ExtNominatorPanel />);

    expect(await waitFor(() => getByLabelText("Friend's name"))).toBeTruthy();
    expect(getByLabelText("Friend's phone number")).toBeTruthy();
  });

  it('does not misreport zero invitations when loading fails and supports retry', async () => {
    mockMe
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ remaining: 2, history: [] });
    const { getByLabelText, getByText, queryByText } = render(<ExtNominatorPanel />);

    expect(await waitFor(() => getByText('Failed to load your invitations.'))).toBeTruthy();
    expect(queryByText(/No invitations left/)).toBeNull();
    fireEvent.press(getByLabelText('Retry loading invitations'));

    expect(await waitFor(() => getByText('2 left'))).toBeTruthy();
    expect(mockMe).toHaveBeenCalledTimes(2);
  });
});
