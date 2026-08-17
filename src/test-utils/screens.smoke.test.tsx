/**
 * Temporary smoke test that proves the render-test harness: every screen below
 * must MOUNT without throwing (a loader / empty state is fine — we only assert
 * no crash). We additionally check that something rendered and, for one screen,
 * that a button press fires the navigation spy — the two things the harness
 * promises ("mounts without error" + "buttons fire"). This is the seed for the
 * wider per-feature screen suite; keep it.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { profileKeys } from '../features/profile/hooks/useProfile';
import { SettingsScreen } from '../features/settings/screens/SettingsScreen/SettingsScreen';
import { FollowersScreen } from '../features/profile/screens/FollowersScreen/FollowersScreen';
import { RoomFeedScreen } from '../features/rooms/screens/RoomFeedScreen/RoomFeedScreen';
import { RoomScreen } from '../features/rooms/screens/RoomScreen/RoomScreen';
import { renderScreen, mockAuthenticated, resetAuth } from './renderScreen';

const smokeUser = {
  id: 'user-test-1',
  username: 'tester',
  displayName: 'Test User',
  firstName: 'Test',
  lastName: 'User',
  bio: null,
  avatarUrl: null,
  twitter: null,
  instagram: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  isOnline: true,
  createdAt: new Date(0).toISOString(),
  invitedBy: null,
};

describe('screen render harness — smoke', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
  });

  it('mounts SettingsScreen and fires navigation on a button press', () => {
    const { navigation, getByLabelText, toJSON } = renderScreen(<SettingsScreen />, {
      seedQueryData: [{ key: [...profileKeys.me()], data: smokeUser }],
    });
    expect(toJSON()).toBeTruthy();
    // Prime the profile query so the smoke test exercises the populated branch.
    fireEvent.press(getByLabelText('Edit profile'));
    expect(navigation.navigate).toHaveBeenCalledWith('EditProfile');
  });

  it('mounts FollowersScreen without crashing', () => {
    const { toJSON } = renderScreen(<FollowersScreen />, {
      route: { name: 'Followers', params: { userId: 'user-test-1', initialTab: 'followers' } },
    });
    expect(toJSON()).toBeTruthy();
  });

  it('mounts RoomFeedScreen without crashing', () => {
    const { toJSON } = renderScreen(<RoomFeedScreen />, { route: { name: 'RoomFeed' } });
    expect(toJSON()).toBeTruthy();
  });

  it('mounts RoomScreen (with roomId param) without crashing', () => {
    const { toJSON } = renderScreen(<RoomScreen />, {
      route: { name: 'Room', params: { roomId: 'room-test-1' } },
    });
    // With no room data primed, the screen shows its loader — that is a valid,
    // crash-free mount (proves the LiveKit / socket / audio stack is stubbed).
    expect(toJSON()).toBeTruthy();
  });
});
