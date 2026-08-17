import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { profileLinksApi, type ProfileLink } from '../api/profileLinksApi';
import { ExtProfileLinks } from './ExtProfileLinks';

jest.mock('../api/profileLinksApi', () => ({
  profileLinksApi: {
    list: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
  },
}));

const mockList = profileLinksApi.list as jest.Mock;
const mockRemove = profileLinksApi.remove as jest.Mock;
const LINK: ProfileLink = {
  id: 'link-1',
  label: 'Newsletter',
  url: 'https://example.test/newsletter',
};

describe('ExtProfileLinks', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('names its editor fields and gives the remove action a 44pt effective target', async () => {
    mockList.mockResolvedValue([LINK]);
    const { getByLabelText } = render(<ExtProfileLinks userId="user-1" editable />);

    expect(await waitFor(() => getByLabelText('Profile link label'))).toBeTruthy();
    expect(getByLabelText('Profile link URL')).toBeTruthy();
    expect(getByLabelText('Remove link Newsletter').props.hitSlop).toBe(6);
  });

  it('surfaces an initial failure and retries successfully', async () => {
    mockList.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([LINK]);
    const { getByLabelText, getByText } = render(<ExtProfileLinks userId="user-1" editable />);

    expect(await waitFor(() => getByText('Failed to load profile links.'))).toBeTruthy();
    fireEvent.press(getByLabelText('Retry loading profile links'));

    expect(await waitFor(() => getByLabelText('Newsletter link'))).toBeTruthy();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('keeps a link visible and announces a remove failure', async () => {
    mockList.mockResolvedValue([LINK]);
    mockRemove.mockRejectedValue(new Error('offline'));
    const { getByLabelText, getByText } = render(<ExtProfileLinks userId="user-1" editable />);

    fireEvent.press(await waitFor(() => getByLabelText('Remove link Newsletter')));
    expect(await waitFor(() => getByText('Failed to remove link'))).toBeTruthy();
    expect(getByLabelText('Newsletter link')).toBeTruthy();
  });
});
