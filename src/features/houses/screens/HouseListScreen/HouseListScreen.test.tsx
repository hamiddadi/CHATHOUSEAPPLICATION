/**
 * HouseListScreen render + button tests. Drives the harness: mounts the screen
 * (seeding the `houseKeys.list('mine')` cache so the FlatList renders a row),
 * then exercises the primary CTAs — header back, the create FAB, the
 * mine/discover tabs, and opening a house row.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { houseKeys } from '../../hooks/useHouses';
import type { HouseSummary } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { HouseListScreen } from './HouseListScreen';

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

describe('HouseListScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
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
});
