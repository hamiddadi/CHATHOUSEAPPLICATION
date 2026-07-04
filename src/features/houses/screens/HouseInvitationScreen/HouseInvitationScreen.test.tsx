/**
 * HouseInvitationScreen render + button tests. Route carries { houseId,
 * inviteToken }. The screen reads the house via `useHouse(houseId)`; we seed
 * `houseKeys.detail` so the populated invite card (with the Accept/Decline CTAs)
 * renders instead of the loader. We exercise: header back (goBack), Decline
 * (goBack), and Accept — asserting the signed invite TOKEN is forwarded to the
 * accept service (so the backend can verify it) and that on success we replace
 * to HouseDetail. We also cover the idempotent "already a member" path and the
 * differentiated expired/invalid error surfacing.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { houseKeys } from '../../hooks/useHouses';
import { houseService } from '../../services/houseService';
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

const TOKEN = 'tok_abcdef12345';
const ROUTE = {
  name: 'HouseInvitation',
  params: { houseId: 'house-1', inviteToken: TOKEN },
};

const seed = (house: House) => [{ key: [...houseKeys.detail(house.id)], data: house }];

describe('HouseInvitationScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
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

  it('never renders the raw invite token on screen (bearer credential)', () => {
    const { queryByText } = renderScreen(<HouseInvitationScreen />, {
      route: ROUTE,
      seedQueryData: seed(fakeHouse()),
    });
    // Neither the full token nor a truncated prefix of it is shown. The RegExp
    // is built from a test-only constant (not user input); the substring match
    // fails the assertion if any text node contains the token prefix.
    // eslint-disable-next-line security/detect-non-literal-regexp
    expect(queryByText(new RegExp(TOKEN.slice(0, 8)))).toBeNull();
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

  it('Accept forwards the signed token to the service and replaces to HouseDetail on success', async () => {
    const spy = jest
      .spyOn(houseService, 'acceptInvitation')
      .mockResolvedValue({ joined: true, alreadyMember: false });
    const { getByText, navigation } = renderScreen(<HouseInvitationScreen />, {
      route: ROUTE,
      seedQueryData: seed(fakeHouse()),
    });
    fireEvent.press(getByText('Accept invitation'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('house-1', TOKEN));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('HouseDetail', { houseId: 'house-1' }),
    );
  });

  it('idempotent already-member: shows a dedicated message then lands on HouseDetail', async () => {
    jest
      .spyOn(houseService, 'acceptInvitation')
      .mockResolvedValue({ joined: true, alreadyMember: true });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, navigation } = renderScreen(<HouseInvitationScreen />, {
      route: ROUTE,
      seedQueryData: seed(fakeHouse()),
    });
    fireEvent.press(getByText('Accept invitation'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    // The alert title reflects the already-member case. The i18n key
    // `houses.invitation.alreadyMemberTitle` is now present in en.json, so the
    // (English) test locale resolves it to "Already a member".
    expect(alertSpy.mock.calls[0]?.[0]).toBe('Already a member');
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('HouseDetail', { houseId: 'house-1' }),
    );
  });

  it('expired invite surfaces the differentiated CLUB_008 message and does NOT navigate', async () => {
    // The interceptors reject a plain-object AppError carrying the backend code.
    jest
      .spyOn(houseService, 'acceptInvitation')
      .mockRejectedValue({ kind: 'forbidden', code: 'CLUB_008', message: 'expired' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByText, navigation } = renderScreen(<HouseInvitationScreen />, {
      route: ROUTE,
      seedQueryData: seed(fakeHouse()),
    });
    fireEvent.press(getByText('Accept invitation'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(navigation.replace).not.toHaveBeenCalled();
    // An error alert is shown (title from the existing `houses.invitation.errorTitle`
    // key, which is present in en.json → "Error"), not a success replace.
    expect(alertSpy.mock.calls[0]?.[0]).toBe('Error');
    // The body carries the differentiated CLUB_008 message. Now that
    // `errors.codes.CLUB_008` is bundled, errorMessage resolves the localized
    // string (English test locale) instead of the raw AppError message.
    expect(alertSpy.mock.calls[0]?.[1]).toBe('This invitation link has expired.');
  });

  it('shows the loader (crash-free) when the house is not yet cached', () => {
    const { getByLabelText, toJSON } = renderScreen(<HouseInvitationScreen />, {
      route: { name: 'HouseInvitation', params: { houseId: 'unseeded', inviteToken: 't' } },
    });
    expect(toJSON()).toBeTruthy();
    expect(getByLabelText('Loading invitation')).toBeTruthy();
  });
});
