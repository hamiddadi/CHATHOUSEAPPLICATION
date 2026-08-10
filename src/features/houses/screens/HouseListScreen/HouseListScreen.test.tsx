/**
 * HouseListScreen render + button tests. Drives the harness: mounts the screen
 * (seeding the `houseKeys.list('mine')` cache so the FlatList renders a row),
 * then exercises the primary CTAs — header back, the create FAB, the
 * mine/discover tabs, and opening a house row.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { houseKeys } from '../../hooks/useHouses';
import { houseService } from '../../services/houseService';
import { searchService } from '../../../search/services/searchService';
import type { HouseSummary } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { filterMyHouses, HouseListScreen } from './HouseListScreen';

const fakeHouse = (overrides: Partial<HouseSummary> = {}): HouseSummary => ({
  id: 'house-1',
  name: 'Indie Hackers',
  category: 'tech',
  categoryEmoji: '💻',
  iconUrl: null,
  membersCount: 1234,
  privacy: 'open',
  ...overrides,
});

describe('filterMyHouses', () => {
  it('matches every term across an accent-insensitive name and category', () => {
    const houses = [
      fakeHouse({ id: 'cafe', name: 'Café des Makers', category: 'tech' }),
      fakeHouse({ id: 'music', name: 'Les Artistes', category: 'music' }),
    ];

    expect(filterMyHouses(houses, 'cafe tech')).toEqual([houses[0]]);
    expect(filterMyHouses(houses, 'MUSIC')).toEqual([houses[1]]);
  });
});

describe('HouseListScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with a seeded house list without crashing', () => {
    const { toJSON, getByText } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
      seedQueryData: [{ key: [...houseKeys.list('mine')], data: [fakeHouse()] }],
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Indie Hackers')).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
      seedQueryData: [{ key: [...houseKeys.list('mine')], data: [] }],
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('create FAB navigates to CreateHouse', () => {
    const { navigation, getByLabelText } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
      seedQueryData: [{ key: [...houseKeys.list('mine')], data: [] }],
    });
    fireEvent.press(getByLabelText('Create a new house'));
    expect(navigation.navigate).toHaveBeenCalledWith('CreateHouse');
  });

  it('pressing a house row navigates to HouseDetail with its id', () => {
    const { navigation, getByLabelText } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
      seedQueryData: [{ key: [...houseKeys.list('mine')], data: [fakeHouse({ id: 'house-42' })] }],
    });
    fireEvent.press(getByLabelText('Open house Indie Hackers'));
    expect(navigation.navigate).toHaveBeenCalledWith('HouseDetail', { houseId: 'house-42' });
  });

  it('empty "mine" list shows an EmptyState whose CTA navigates to CreateHouse', () => {
    const { navigation, getByText } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
      seedQueryData: [{ key: [...houseKeys.list('mine')], data: [] }],
    });
    // A brand-new user must not face a blank screen.
    expect(getByText('No houses yet')).toBeTruthy();
    fireEvent.press(getByText('Create a house'));
    expect(navigation.navigate).toHaveBeenCalledWith('CreateHouse');
  });

  it('load failure shows an error state whose Retry refetches the list', async () => {
    const listSpy = jest
      .spyOn(houseService, 'list')
      .mockRejectedValue({ kind: 'network', message: 'down' });
    const { findByText } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
    });
    expect(await findByText("Couldn't load houses")).toBeTruthy();
    expect(listSpy).toHaveBeenCalledTimes(1);
    fireEvent.press(await findByText('Retry'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
  });

  it('switching to the Discover tab does not crash', () => {
    const { getByText, toJSON } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
      seedQueryData: [
        { key: [...houseKeys.list('mine')], data: [fakeHouse()] },
        {
          key: [...houseKeys.list('discover')],
          data: [fakeHouse({ id: 'house-2', name: 'Designers' })],
        },
      ],
    });
    fireEvent.press(getByText('Discover'));
    expect(toJSON()).toBeTruthy();
  });

  it('filters My Houses locally without calling the remote club search', () => {
    const clubsSpy = jest.spyOn(searchService, 'clubs');
    const { getByLabelText, getByText, queryByText } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
      seedQueryData: [
        {
          key: [...houseKeys.list('mine')],
          data: [
            fakeHouse({ id: 'house-tech', name: 'Café Tech', category: 'tech' }),
            fakeHouse({ id: 'house-music', name: 'Music Makers', category: 'music' }),
          ],
        },
      ],
    });

    fireEvent.changeText(getByLabelText('Search houses'), 'cafe tech');

    expect(getByText('Café Tech')).toBeTruthy();
    expect(queryByText('Music Makers')).toBeNull();
    expect(clubsSpy).not.toHaveBeenCalled();
  });

  it('debounces Discover search and never renders a private API result', async () => {
    const clubsSpy = jest
      .spyOn(searchService, 'clubs')
      .mockResolvedValue([
        fakeHouse({ id: 'public', name: 'Design Commons', privacy: 'open' }),
        fakeHouse({ id: 'private', name: 'Private Design Circle', privacy: 'private' }),
      ]);
    const { getByLabelText, getByText, findByText, queryByText } = renderScreen(
      <HouseListScreen />,
      {
        route: { name: 'HouseList' },
        seedQueryData: [
          { key: [...houseKeys.list('mine')], data: [] },
          { key: [...houseKeys.list('discover')], data: [] },
        ],
      },
    );

    fireEvent.press(getByText('Discover'));
    fireEvent.changeText(getByLabelText('Search houses'), 'design');

    expect(clubsSpy).not.toHaveBeenCalled();
    expect(await findByText('Design Commons')).toBeTruthy();
    expect(clubsSpy).toHaveBeenCalledTimes(1);
    expect(clubsSpy).toHaveBeenCalledWith('design');
    expect(queryByText('Private Design Circle')).toBeNull();
  });

  it('does not re-surface an already joined House in Discover search', async () => {
    const joined = fakeHouse({ id: 'joined', name: 'Joined Design House' });
    jest
      .spyOn(searchService, 'clubs')
      .mockResolvedValue([joined, fakeHouse({ id: 'new', name: 'New Design House' })]);
    const { getByLabelText, getByText, findByText, queryByText } = renderScreen(
      <HouseListScreen />,
      {
        route: { name: 'HouseList' },
        seedQueryData: [
          { key: [...houseKeys.list('mine')], data: [joined] },
          { key: [...houseKeys.list('discover')], data: [] },
        ],
      },
    );

    fireEvent.press(getByText('Discover'));
    fireEvent.changeText(getByLabelText('Search houses'), 'design');

    expect(await findByText('New Design House')).toBeTruthy();
    expect(queryByText('Joined Design House')).toBeNull();
  });

  it('shows a search-specific empty state and clears the query', async () => {
    jest.spyOn(searchService, 'clubs').mockResolvedValue([]);
    const { getByLabelText, getByText, findByText, getByDisplayValue } = renderScreen(
      <HouseListScreen />,
      {
        route: { name: 'HouseList' },
        seedQueryData: [
          { key: [...houseKeys.list('mine')], data: [] },
          { key: [...houseKeys.list('discover')], data: [] },
        ],
      },
    );

    fireEvent.press(getByText('Discover'));
    fireEvent.changeText(getByLabelText('Search houses'), 'unknown');

    expect(await findByText('No houses found')).toBeTruthy();
    fireEvent.press(getByText('Clear search'));
    expect(getByDisplayValue('')).toBeTruthy();
    expect(getByText('Nothing to discover')).toBeTruthy();
  });

  it('shows a retryable error when Discover search fails', async () => {
    const clubsSpy = jest
      .spyOn(searchService, 'clubs')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([]);
    const { getByLabelText, getByText, findByText } = renderScreen(<HouseListScreen />, {
      route: { name: 'HouseList' },
      seedQueryData: [
        { key: [...houseKeys.list('mine')], data: [] },
        { key: [...houseKeys.list('discover')], data: [] },
      ],
    });

    fireEvent.press(getByText('Discover'));
    fireEvent.changeText(getByLabelText('Search houses'), 'design');

    expect(await findByText("Couldn't search houses")).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(clubsSpy).toHaveBeenCalledTimes(2));
  });
});
