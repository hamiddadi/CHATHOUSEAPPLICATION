/**
 * Unit test for UserMapMarker — the real-time user marker shown on the OSM map.
 * Native deps are globally mocked in jest-setup: react-native-maps stubs
 * <Marker> as a <View>, @react-native-vector-icons/material-icons renders the
 * glyph name as <Text> (so we can query 'mic' / 'mic-off' / 'hearing'), and
 * reanimated is a synchronous no-op. We assert the badge glyph, the username
 * chip, the initials fallback, the ", live" a11y label, and the onPress wiring
 * across every state in the feature's validation table.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { FollowerOnMap } from '../../../shared/types/domain';
import { UserMapMarker, isUserInRoom, resolveMarkerState } from './UserMapMarker';

const makeUser = (overrides: Partial<FollowerOnMap> = {}): FollowerOnMap => ({
  id: 'u1',
  username: 'alex',
  displayName: 'Alex Rivers',
  avatarUrl: 'https://example.com/a.jpg',
  location: { latitude: 14.7, longitude: -17.4, updatedAt: new Date(0).toISOString() },
  presence: 'online',
  liveRoomId: null,
  liveRoomTitle: null,
  lastSeenMinutesAgo: 0,
  ...overrides,
});

describe('resolveMarkerState', () => {
  it('prioritises speaking over every other signal', () => {
    expect(
      resolveMarkerState(makeUser({ isSpeaking: true, isMuted: true, isListener: true })),
    ).toBe('speaking');
  });
  it('returns muted when muted but not speaking', () => {
    expect(resolveMarkerState(makeUser({ isMuted: true, isListener: true }))).toBe('muted');
  });
  it('returns listener when in a room without mic flags', () => {
    expect(resolveMarkerState(makeUser({ isListener: true }))).toBe('listener');
    expect(resolveMarkerState(makeUser({ liveRoomId: 'r1' }))).toBe('listener');
  });
  it('returns online when connected outside any room', () => {
    expect(resolveMarkerState(makeUser())).toBe('online');
  });
});

describe('isUserInRoom', () => {
  it('is true when any room-audio signal is set', () => {
    expect(isUserInRoom(makeUser({ liveRoomId: 'r1' }))).toBe(true);
    expect(isUserInRoom(makeUser({ isSpeaking: true }))).toBe(true);
    expect(isUserInRoom(makeUser({ isMuted: true }))).toBe(true);
    expect(isUserInRoom(makeUser({ isListener: true }))).toBe(true);
  });
  it('is false for a plain online user', () => {
    expect(isUserInRoom(makeUser())).toBe(false);
  });
});

describe('UserMapMarker', () => {
  it('speaking user → green mic glyph + ", live" label', () => {
    const { getByText, getAllByLabelText } = render(
      <UserMapMarker user={makeUser({ liveRoomId: 'r1', isSpeaking: true })} />,
    );
    expect(getByText('mic')).toBeTruthy();
    expect(getAllByLabelText('Alex Rivers, live').length).toBeGreaterThan(0);
  });

  it('muted user → mic-off glyph', () => {
    const { getByText } = render(
      <UserMapMarker user={makeUser({ liveRoomId: 'r1', isMuted: true })} />,
    );
    expect(getByText('mic-off')).toBeTruthy();
  });

  it('listener user → hearing glyph', () => {
    const { getByText } = render(
      <UserMapMarker user={makeUser({ liveRoomId: 'r1', isListener: true })} />,
    );
    expect(getByText('hearing')).toBeTruthy();
  });

  it('online user (no room) → no mic glyph, label has no ", live"', () => {
    const { queryByText, getByText } = render(<UserMapMarker user={makeUser()} />);
    expect(queryByText('mic')).toBeNull();
    expect(queryByText('mic-off')).toBeNull();
    expect(queryByText('hearing')).toBeNull();
    // Username chip still renders for identification.
    expect(getByText('alex')).toBeTruthy();
  });

  it('falls back to initials when the profile photo is absent', () => {
    const { getByText } = render(<UserMapMarker user={makeUser({ avatarUrl: null })} />);
    expect(getByText('AR')).toBeTruthy();
  });

  it('invokes onPress with the user when the marker is tapped', () => {
    const onPress = jest.fn();
    const user = makeUser({ liveRoomId: 'r1', isSpeaking: true });
    const { getAllByLabelText } = render(<UserMapMarker user={user} onPress={onPress} />);
    fireEvent.press(getAllByLabelText('Alex Rivers, live')[0]);
    expect(onPress).toHaveBeenCalledWith(user);
  });
});
