/**
 * HouseDetailScreen render + button tests. The screen is data-driven: with no
 * cached house it shows a loader, so we seed `houseKeys.detail(houseId)` with a
 * full House (viewer materialised as an ADMIN member → the manage gear + member
 * management surface). Then we exercise: header back, the manage gear, options
 * menu, the membership-aware "Invite members" CTA, the join CTA (open house),
 * and tapping a room row.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { houseKeys } from '../../hooks/useHouses';
import type { House, HouseMember } from '../../../../shared/types/domain';
import type { HouseRoom } from '../../services/houseService';
import {
  renderScreen,
  mockAuthenticated,
  resetAuth,
  fakeAuthUser,
} from '../../../../test-utils/renderScreen';
import { HouseDetailScreen } from './HouseDetailScreen';

const VIEWER_ID = 'user-test-1';

const adminMember = (): HouseMember => ({
  id: VIEWER_ID,
  username: 'tester',
  displayName: 'Test User',
  avatarUrl: null,
  role: 'admin',
  joinedAt: new Date(0).toISOString(),
});

const otherMember = (): HouseMember => ({
  id: 'user-2',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  role: 'member',
  joinedAt: new Date(0).toISOString(),
});

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
  liveRoomsCount: 1,
  isJoinedByMe: true,
  members: [adminMember(), otherMember()],
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

const liveRoom = (): HouseRoom => ({
  id: 'room-1',
  title: 'Morning standup',
  isLive: true,
  participantCount: 5,
  scheduledFor: null,
});

const seedHouse = (house: House, liveRooms: HouseRoom[] = []) => [
  { key: [...houseKeys.detail(house.id)], data: house },
  { key: [...houseKeys.rooms(house.id, 'live')], data: liveRooms },
  { key: [...houseKeys.rooms(house.id, 'upcoming')], data: [] as HouseRoom[] },
];

describe('HouseDetailScreen', () => {
  beforeEach(() => {
    mockAuthenticated(fakeAuthUser({ id: VIEWER_ID }));
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with a seeded house and shows its name', () => {
    const house = fakeHouse();
    const { getByText, toJSON } = renderScreen(<HouseDetailScreen />, {
      route: { name: 'HouseDetail', params: { houseId: house.id } },
      seedQueryData: seedHouse(house),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Indie Hackers')).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const house = fakeHouse();
    const { navigation, getByLabelText } = renderScreen(<HouseDetailScreen />, {
      route: { name: 'HouseDetail', params: { houseId: house.id } },
      seedQueryData: seedHouse(house),
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('manage gear (admin viewer) navigates to ManageHouse with the houseId', () => {
    const house = fakeHouse();
    const { navigation, getByLabelText } = renderScreen(<HouseDetailScreen />, {
      route: { name: 'HouseDetail', params: { houseId: house.id } },
      seedQueryData: seedHouse(house),
    });
    fireEvent.press(getByLabelText('Manage house'));
    expect(navigation.navigate).toHaveBeenCalledWith('ManageHouse', { houseId: house.id });
  });

  it('"Invite members" CTA (joined house) navigates to InviteMember', () => {
    const house = fakeHouse({ isJoinedByMe: true });
    const { navigation, getByText } = renderScreen(<HouseDetailScreen />, {
      route: { name: 'HouseDetail', params: { houseId: house.id } },
      seedQueryData: seedHouse(house),
    });
    fireEvent.press(getByText('Invite members'));
    expect(navigation.navigate).toHaveBeenCalledWith('InviteMember', { houseId: house.id });
  });

  it('options menu opens a native Alert without crashing', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const house = fakeHouse();
    const { getByLabelText } = renderScreen(<HouseDetailScreen />, {
      route: { name: 'HouseDetail', params: { houseId: house.id } },
      seedQueryData: seedHouse(house),
    });
    fireEvent.press(getByLabelText('House options'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('"Rejoindre" CTA (open, not joined) fires the join mutation without crashing', () => {
    // Viewer is NOT a member here → not an admin, so the join CTA is shown.
    const house = fakeHouse({
      isJoinedByMe: false,
      ownerId: 'someone-else',
      members: [otherMember()],
    });
    const { getByText, toJSON } = renderScreen(<HouseDetailScreen />, {
      route: { name: 'HouseDetail', params: { houseId: house.id } },
      seedQueryData: seedHouse(house),
    });
    fireEvent.press(getByText('Rejoindre'));
    expect(toJSON()).toBeTruthy();
  });

  it('tapping a live room row navigates to Room with its id', () => {
    const house = fakeHouse();
    const { navigation, getByLabelText } = renderScreen(<HouseDetailScreen />, {
      route: { name: 'HouseDetail', params: { houseId: house.id } },
      seedQueryData: seedHouse(house, [liveRoom()]),
    });
    fireEvent.press(getByLabelText('Open room Morning standup'));
    expect(navigation.navigate).toHaveBeenCalledWith('Room', { roomId: 'room-1' });
  });

  it('shows the loader (crash-free) when the house is not yet cached', () => {
    const { getByLabelText, toJSON } = renderScreen(<HouseDetailScreen />, {
      route: { name: 'HouseDetail', params: { houseId: 'unseeded' } },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByLabelText('Loading house')).toBeTruthy();
  });
});
