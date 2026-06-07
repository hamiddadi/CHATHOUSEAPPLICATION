import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { useHouses } from '../../hooks/useHouses';
import type { HouseSummary } from '../../../../shared/types/domain';
import { HouseListScreen } from './HouseListScreen';

// Keep houseKeys (and the other real exports) intact; only swap the data hook so
// no real network/react-query work runs during the test.
jest.mock('../../hooks/useHouses', () => {
  const actual = jest.requireActual('../../hooks/useHouses');
  return { ...actual, useHouses: jest.fn() };
});

const mockUseHouses = useHouses as jest.Mock;

type HousesQuery = ReturnType<typeof useHouses>;

const queryState = (over: Partial<HousesQuery> = {}): HousesQuery =>
  ({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
    error: null,
    ...over,
  }) as unknown as HousesQuery;

const house = (over: Partial<HouseSummary> = {}): HouseSummary =>
  ({
    id: 'h1',
    name: 'Indie Hackers',
    category: 'Startups',
    categoryEmoji: '🚀',
    iconUrl: null,
    membersCount: 1234,
    privacy: 'public',
    ...over,
  }) as HouseSummary;

describe('HouseListScreen', () => {
  beforeEach(() => {
    mockUseHouses.mockReset();
  });

  it('renders the header, tabs and create FAB', () => {
    mockUseHouses.mockReturnValue(queryState({ data: [] }));
    renderScreen(<HouseListScreen />);

    expect(screen.getByText('Houses')).toBeTruthy();
    expect(screen.getByText('My Houses')).toBeTruthy();
    expect(screen.getByText('Discover')).toBeTruthy();
    expect(screen.getByLabelText('Create a new house')).toBeTruthy();
  });

  it('shows the loader while houses are loading', () => {
    mockUseHouses.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<HouseListScreen />);

    expect(screen.getByLabelText('Loading houses')).toBeTruthy();
  });

  it('shows the error state when the query fails', () => {
    mockUseHouses.mockReturnValue(queryState({ isError: true }));
    renderScreen(<HouseListScreen />);

    expect(screen.getByText("Couldn't load houses")).toBeTruthy();
    expect(screen.getByText('Check your connection.')).toBeTruthy();
  });

  it('renders a row per house when loaded', () => {
    mockUseHouses.mockReturnValue(
      queryState({ data: [house(), house({ id: 'h2', name: 'Designers' })] }),
    );
    renderScreen(<HouseListScreen />);

    expect(screen.getByLabelText('Open house Indie Hackers')).toBeTruthy();
    expect(screen.getByLabelText('Open house Designers')).toBeTruthy();
  });

  it('navigates to HouseDetail when a house row is pressed', () => {
    mockUseHouses.mockReturnValue(queryState({ data: [house()] }));
    const { navigation } = renderScreen(<HouseListScreen />);

    fireEvent.press(screen.getByLabelText('Open house Indie Hackers'));

    expect(navigation.navigate).toHaveBeenCalledWith('HouseDetail', { houseId: 'h1' });
  });

  it('navigates to CreateHouse from the FAB and back from the header', () => {
    mockUseHouses.mockReturnValue(queryState({ data: [] }));
    const { navigation } = renderScreen(<HouseListScreen />);

    fireEvent.press(screen.getByLabelText('Create a new house'));
    expect(navigation.navigate).toHaveBeenCalledWith('CreateHouse');

    fireEvent.press(screen.getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('switches the active tab to Discover and refetches for that filter', async () => {
    mockUseHouses.mockReturnValue(queryState({ data: [] }));
    renderScreen(<HouseListScreen />);

    expect(mockUseHouses).toHaveBeenCalledWith('mine');

    fireEvent.press(screen.getByText('Discover'));

    await waitFor(() => {
      expect(mockUseHouses).toHaveBeenCalledWith('discover');
    });
  });
});
