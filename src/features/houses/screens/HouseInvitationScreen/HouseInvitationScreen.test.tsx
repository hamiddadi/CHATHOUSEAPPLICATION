/**
 * HouseInvitationScreen render + button tests. Route carries { houseId,
 * inviteToken }. The screen reads the house via `useHouse(houseId)`; we seed
 * `houseKeys.detail` so the populated invite card (with the Accept/Decline CTAs)
 * renders instead of the loader. We exercise: header back (goBack), Decline
 * (goBack), and Accept (fires acceptInvitation; on success it would replace to
 * HouseDetail — against the unmocked api it resolves/rejects async, so we only
 * assert the press is crash-free).
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { houseKeys } from '../../hooks/useHouses';
import type { House } from '../../../../shared/types/domain';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { HouseInvitationScreen } from './HouseInvitationScreen';

const fakeHouse = (overrides: Partial<House> = {}): House => ({
  id: 'house-1',
  name: 'Indie Hackers',
  description: 'A house for builders',
  category: 'tech',
  categoryEmoji: '💻',
  iconUrl: null,
  privacy: 'private',
  ownerId: 'owner-1',
  membersCount: 42,
  liveRoomsCount: 0,
  isJoinedByMe: false,
  members: [],
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

const ROUTE = {
  name: 'HouseInvitation',
  params: { houseId: 'house-1', inviteToken: 'tok_abcdef12345' },
};

const seed = (house: House) => [{ key: [...houseKeys.detail(house.id)], data: house }];

describe('HouseInvitationScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts with a seeded house and shows its name + CTAs', () => {
    const { toJSON, getByText } = renderScreen(<HouseInvitationScreen />, {
      route: ROUTE,
      seedQueryData: seed(fakeHouse()),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Indie Hackers')).toBeTruthy();
    expect(getByText('Accept invitation')).toBeTruthy();
    expect(getByText('Decline')).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderScreen(<HouseInvitationScreen />, {
      route: ROUTE,
      seedQueryData: seed(fakeHouse()),
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('Decline calls navigation.goBack', () => {
    const { navigation, getByText } = renderScreen(<HouseInvitationScreen />, {
      route: ROUTE,
      seedQueryData: seed(fakeHouse()),
    });
    fireEvent.press(getByText('Decline'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('Accept invitation fires the accept mutation without crashing', () => {
    const { getByText, toJSON } = renderScreen(<HouseInvitationScreen />, {
      route: ROUTE,
      seedQueryData: seed(fakeHouse()),
    });
    fireEvent.press(getByText('Accept invitation'));
    expect(toJSON()).toBeTruthy();
  });

  it('shows the loader (crash-free) when the house is not yet cached', () => {
    const { getByLabelText, toJSON } = renderScreen(<HouseInvitationScreen />, {
      route: { name: 'HouseInvitation', params: { houseId: 'unseeded', inviteToken: 't' } },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByLabelText('Loading invitation')).toBeTruthy();
  });
});
