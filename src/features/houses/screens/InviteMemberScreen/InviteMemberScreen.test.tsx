/**
 * InviteMemberScreen render + button tests. Route carries { houseId }. User
 * search is debounced + disabled while the query is empty, so on mount the
 * screen shows its empty state (no loader, no rows) — a clean mount. We
 * exercise the always-present CTAs: close (goBack) and the copy-invite-link
 * button (Clipboard is globally mocked; on success it opens a confirm Alert).
 *
 * The shareable link is now a SERVER-minted signed link (carrying a token
 * aligned with the `house/:houseId/invite/:token` deep link route). We seed the
 * `houseKeys.inviteLink` query so the real URL is present without a network
 * round-trip.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { houseService } from '../../services/houseService';
import { profileKeys } from '../../../profile/hooks/useProfile';
import { profileService } from '../../../profile/services/profileService';
import type { User } from '../../../../shared/types/domain';
import { houseKeys } from '../../hooks/useHouses';
import { InviteMemberScreen } from './InviteMemberScreen';

const ROUTE = { name: 'InviteMember', params: { houseId: 'house-1' } };

const INVITE_URL = 'https://app.chathouse.com/house/house-1/invite/tok_abc.sig';

// Seed the signed invite link so the copy/share affordance has a real URL.
const seedLink = () => [
  { key: [...houseKeys.inviteLink('house-1')], data: { token: 'tok_abc.sig', url: INVITE_URL } },
];

const fakeUser = (overrides: Partial<User> = {}): User => ({
  id: 'u-1',
  username: 'alice',
  displayName: 'Alice',
  bio: null,
  avatarUrl: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  isOnline: false,
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

// Seed the signed link AND a pre-resolved user-search result for query "alice"
// so a row is present to invite. useSearchUsers uses profileKeys.search(q) and
// only fires for a non-empty (trimmed) query — so we seed the debounced term.
const seedLinkAndSearch = (users: User[]) => [
  ...seedLink(),
  { key: [...profileKeys.search('alice')], data: users },
];

describe('InviteMemberScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and shows the title + the server-minted shareable invite link', () => {
    const { toJSON, getByText } = renderScreen(<InviteMemberScreen />, {
      route: ROUTE,
      seedQueryData: seedLink(),
    });
    expect(toJSON()).toBeTruthy();
    // i18n en.json: houses.invite.title === 'Invite Member'.
    expect(getByText('Invite Member')).toBeTruthy();
    // The on-screen link is the server URL with its scheme stripped — and it is
    // the token-carrying `house/.../invite/...` deep-link path, NOT `/invite/id`.
    expect(getByText('app.chathouse.com/house/house-1/invite/tok_abc.sig')).toBeTruthy();
  });

  it('close button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderScreen(<InviteMemberScreen />, {
      route: ROUTE,
      seedQueryData: seedLink(),
    });
    fireEvent.press(getByLabelText('Close invite dialog'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('copy-link button copies the SERVER URL and opens the confirm Alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const setStringSpy = jest.spyOn(Clipboard, 'setString');
    const { getByLabelText } = renderScreen(<InviteMemberScreen />, {
      route: ROUTE,
      seedQueryData: seedLink(),
    });
    fireEvent.press(getByLabelText('Copy invite link'));
    // Clipboard.setString resolves async (mock) → Alert is fired after the await.
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    // It must copy the routable token URL, not a bare houseId link.
    expect(setStringSpy).toHaveBeenCalledWith(INVITE_URL);
  });

  it('replaces a failed invite-link placeholder with an explicit retry action', async () => {
    const linkSpy = jest
      .spyOn(houseService, 'getInviteLink')
      .mockRejectedValue(new Error('offline'));
    const { findByText, getByLabelText } = renderScreen(<InviteMemberScreen />, {
      route: ROUTE,
    });

    expect(await findByText('Something went wrong')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry invite link'));
    await waitFor(() => expect(linkSpy).toHaveBeenCalledTimes(2));
  });

  it('typing a search query does not crash the screen', () => {
    const { getByPlaceholderText, toJSON } = renderScreen(<InviteMemberScreen />, {
      route: ROUTE,
      seedQueryData: seedLink(),
    });
    fireEvent.changeText(getByPlaceholderText('Search users'), 'alice');
    expect(toJSON()).toBeTruthy();
  });

  it('shows a retryable search error instead of reporting no results', async () => {
    const searchSpy = jest.spyOn(profileService, 'search').mockRejectedValue(new Error('offline'));
    const { findByText, getByPlaceholderText, getByText, queryByText } = renderScreen(
      <InviteMemberScreen />,
      { route: ROUTE, seedQueryData: seedLink() },
    );

    fireEvent.changeText(getByPlaceholderText('Search users'), 'alice');
    expect(await findByText('Search failed')).toBeTruthy();
    expect(queryByText('No results')).toBeNull();

    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
  });

  it('a fresh invitation (sent > 0) marks the row as "Invited"', async () => {
    const inviteSpy = jest
      .spyOn(houseService, 'invite')
      .mockResolvedValue({ sent: 1, token: 't', url: INVITE_URL });
    const { getByText, getByPlaceholderText } = renderScreen(<InviteMemberScreen />, {
      route: ROUTE,
      seedQueryData: seedLinkAndSearch([fakeUser()]),
    });
    // Drive the debounced query to "alice" so the seeded search row renders.
    fireEvent.changeText(getByPlaceholderText('Search users'), 'alice');
    await waitFor(() => expect(getByText('Invite')).toBeTruthy());
    fireEvent.press(getByText('Invite'));
    await waitFor(() => expect(inviteSpy).toHaveBeenCalledWith('house-1', ['u-1']));
    // en.json houses.invite.invited === 'Invited'.
    await waitFor(() => expect(getByText('Invited')).toBeTruthy());
  });

  it('an invitation to an existing member (sent === 0) marks the row "Member", not "Invited"', async () => {
    // Backend reports sent:0 when the target was already a member — the UI must
    // NOT falsely claim a fresh invite was dispatched.
    jest.spyOn(houseService, 'invite').mockResolvedValue({ sent: 0, token: 't', url: INVITE_URL });
    const { getByText, queryByText, getByPlaceholderText } = renderScreen(<InviteMemberScreen />, {
      route: ROUTE,
      seedQueryData: seedLinkAndSearch([fakeUser()]),
    });
    fireEvent.changeText(getByPlaceholderText('Search users'), 'alice');
    await waitFor(() => expect(getByText('Invite')).toBeTruthy());
    fireEvent.press(getByText('Invite'));
    // en.json houses.invite.alreadyMember === 'Member'.
    await waitFor(() => expect(getByText('Member')).toBeTruthy());
    expect(queryByText('Invited')).toBeNull();
  });
});
