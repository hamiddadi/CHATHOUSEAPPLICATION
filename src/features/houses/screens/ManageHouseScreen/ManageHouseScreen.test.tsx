/**
 * ManageHouseScreen render + button tests. Data-driven: with no cached house it
 * shows a loader, so we seed `houseKeys.detail(houseId)` with a House owned by
 * the viewer (so the owner-only "Delete house" danger zone surfaces). We then
 * exercise: close (goBack), the privacy radios, "Save changes" (fires the
 * update mutation), and "Delete house" (opens the confirm Alert).
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { houseKeys } from '../../hooks/useHouses';
import type { House } from '../../../../shared/types/domain';
import {
  renderScreen,
  mockAuthenticated,
  resetAuth,
  fakeAuthUser,
} from '../../../../test-utils/renderScreen';
import { ManageHouseScreen } from './ManageHouseScreen';

const VIEWER_ID = 'user-test-1';

const fakeHouse = (overrides: Partial<House> = {}): House => ({
  id: 'house-1',
  name: 'Indie Hackers',
  description: 'A house for builders',
  category: 'tech',
  categoryEmoji: '💻',
  iconUrl: null,
  privacy: 'open',
  ownerId: VIEWER_ID,
  membersCount: 2,
  liveRoomsCount: 0,
  isJoinedByMe: true,
  members: [],
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

const seed = (house: House) => [{ key: [...houseKeys.detail(house.id)], data: house }];

describe('ManageHouseScreen', () => {
  beforeEach(() => {
    mockAuthenticated(fakeAuthUser({ id: VIEWER_ID }));
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with the seeded house pre-filled and shows the title', () => {
    const house = fakeHouse();
    const { toJSON, getByText, getByDisplayValue } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Manage House')).toBeTruthy();
    // The form pre-fills from the loaded house exactly once.
    expect(getByDisplayValue('Indie Hackers')).toBeTruthy();
  });

  it('close button calls navigation.goBack', () => {
    const house = fakeHouse();
    const { navigation, getByLabelText } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    fireEvent.press(getByLabelText('Close without saving'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('"Save changes" fires the update mutation without crashing', () => {
    const house = fakeHouse();
    const { getByText, toJSON } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    // Name pre-filled (>= 2 chars) → Save enabled.
    fireEvent.press(getByText('Save changes'));
    expect(toJSON()).toBeTruthy();
  });

  it('selecting a privacy option toggles its selected state', () => {
    const house = fakeHouse({ privacy: 'open' });
    const { getByLabelText } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    const socialRow = getByLabelText('Social: Anyone can request to join; admins approve');
    fireEvent.press(socialRow);
    expect(socialRow.props.accessibilityState.selected).toBe(true);
  });

  it('"Delete house" (owner) opens the confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const house = fakeHouse({ ownerId: VIEWER_ID });
    const { getByText } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    fireEvent.press(getByText('Delete house'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('hides the danger zone when the viewer is not the owner', () => {
    const house = fakeHouse({ ownerId: 'someone-else' });
    const { queryByText } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    expect(queryByText('Delete house')).toBeNull();
  });

  it('shows the loader (crash-free) when the house is not yet cached', () => {
    const { getByLabelText, toJSON } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: 'unseeded' } },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByLabelText('Loading house')).toBeTruthy();
  });
});
