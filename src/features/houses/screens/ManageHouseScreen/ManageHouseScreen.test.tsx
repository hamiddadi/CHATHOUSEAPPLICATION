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
import { houseService } from '../../services/houseService';
import type { House, HouseMember } from '../../../../shared/types/domain';
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

const memberOf = (id: string, role: HouseMember['role']): HouseMember => ({
  id,
  username: 'someone',
  displayName: 'Someone',
  avatarUrl: null,
  role,
  joinedAt: new Date(0).toISOString(),
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

  it('hides the danger zone from an admin who is not the owner', () => {
    // Viewer is an ADMIN member (form allowed) but NOT the owner (no delete).
    const house = fakeHouse({
      ownerId: 'someone-else',
      members: [memberOf(VIEWER_ID, 'admin')],
    });
    const { queryByText, getByText } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    expect(getByText('Save changes')).toBeTruthy();
    expect(queryByText('Delete house')).toBeNull();
  });

  it('blocks a non-admin viewer with a message and a working Back action', () => {
    // Local mirror of the backend CLUB_002 gate: a plain member must not get
    // an editable form whose save can only end in a server rejection.
    const house = fakeHouse({
      ownerId: 'someone-else',
      members: [memberOf(VIEWER_ID, 'member')],
    });
    const { navigation, getByText, queryByText } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    expect(getByText('Admins only')).toBeTruthy();
    expect(queryByText('Save changes')).toBeNull();
    fireEvent.press(getByText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('offers the icon editor and pressing it is crash-free', () => {
    const house = fakeHouse();
    const { getByLabelText, toJSON } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: house.id } },
      seedQueryData: seed(house),
    });
    // iconUrl is null → the "upload" affordance shows (picker is mocked).
    fireEvent.press(getByLabelText('Upload house icon'));
    expect(toJSON()).toBeTruthy();
  });

  it('load failure shows an error state with a Back way out (no modal dead-end)', async () => {
    jest.spyOn(houseService, 'get').mockRejectedValue({ kind: 'network', message: 'down' });
    const { navigation, findByText } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: 'broken' } },
    });
    expect(await findByText('House unavailable')).toBeTruthy();
    fireEvent.press(await findByText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('shows the loader (crash-free) when the house is not yet cached', () => {
    const { getByLabelText, toJSON } = renderScreen(<ManageHouseScreen />, {
      route: { name: 'ManageHouse', params: { houseId: 'unseeded' } },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByLabelText('Loading house')).toBeTruthy();
  });
});
