/**
 * Render-test for MapsScreen. The location flow is async (useCurrentLocation
 * runs PermissionsAndroid.check + Geolocation.getCurrentPosition in an effect),
 * so the screen first shows the "Locating you" loader and then the map once a
 * fix resolves. We force the granted path by stubbing PermissionsAndroid.check
 * → true (skips the consent Alert + OS request); the geolocation mock supplies
 * a deterministic Paris fix, and useFollowersOnMap seeds the 5 mock followers
 * (REALTIME disabled in tests). We exercise the recenter button, the See/Unsee
 * (ghost) toggle, and tapping a follower pin to open the mini-card. Native
 * modules are globally mocked in jest-setup.
 */
import React from 'react';
import { PermissionsAndroid } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { MapsScreen } from './MapsScreen';

// react-native-dotenv inlines `.env` into `@env` at babel-transform time, so the
// jest-setup `@env` mock can't force REALTIME_ENABLED=false — under jest it stays
// `true`, which makes useFollowersOnMap start from an empty roster fed only by the
// (inert) socket. Inject the demo roster directly so the pin / mini-card UI is
// exercised deterministically. This is the production "demo mode" roster verbatim.
jest.mock('../../hooks/useFollowersOnMap', () => ({
  useFollowersOnMap: () =>
    require('../../../../shared/mocks/followersOnMap.mock').MOCK_FOLLOWERS_ON_MAP,
}));

describe('MapsScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
    // Force the granted permission path so the map (not the consent flow) renders.
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('shows the "Locating you" loader on first render', () => {
    const { getByLabelText } = renderScreen(<MapsScreen />, {
      route: { name: 'Maps', params: {} },
    });
    // coords null + ready false on the very first render → Loader.
    expect(getByLabelText('Locating you')).toBeTruthy();
  });

  it('renders the map (search bar + follower pins) once a fix resolves', async () => {
    const { getByLabelText, getAllByLabelText } = renderScreen(<MapsScreen />, {
      route: { name: 'Maps', params: {} },
    });
    // After the async location effect settles, the map UI is shown.
    await waitFor(() => expect(getByLabelText('Find a friend')).toBeTruthy());
    // First mock follower (Alex Rivers) has a live room → label includes ", live".
    // The label appears twice (the Marker annotation + the FollowerPin custom
    // content both set it — on native these are distinct layers; once Marker is
    // mocked as a View they collapse into two matching nodes).
    expect(getAllByLabelText('Alex Rivers, live').length).toBeGreaterThan(0);
  });

  it('recenter ("my location") button is pressable without throwing', async () => {
    const { getByLabelText } = renderScreen(<MapsScreen />, {
      route: { name: 'Maps', params: {} },
    });
    const recenter = await waitFor(() => getByLabelText('Recenter map on my location'));
    expect(() => fireEvent.press(recenter)).not.toThrow();
  });

  it('See/Unsee (ghost mode) toggle is pressable without throwing', async () => {
    const { getByLabelText } = renderScreen(<MapsScreen />, {
      route: { name: 'Maps', params: {} },
    });
    const toggle = await waitFor(() => getByLabelText('You are visible. Tap to hide.'));
    expect(() => fireEvent.press(toggle)).not.toThrow();
  });

  it('tapping a follower pin opens the mini-card; "Message" navigates to the DM thread', async () => {
    const { getAllByLabelText, getByText, navigation } = renderScreen(<MapsScreen />, {
      route: { name: 'Maps', params: {} },
    });
    // [0] is the outer Marker (carries onPress); [1] is the inner FollowerPin.
    const pin = (await waitFor(() => getAllByLabelText('Alex Rivers, live')))[0];
    fireEvent.press(pin);
    // Mini-card surfaces a Message button.
    const messageBtn = await waitFor(() => getByText('Message'));
    fireEvent.press(messageBtn);
    expect(navigation.navigate).toHaveBeenCalledWith('Main', {
      screen: 'MessagesTab',
      params: { screen: 'ChatDetail', params: { conversationId: 'u1' } },
    });
  });

  it('mini-card "Join Room" (live follower) navigates into the Room', async () => {
    const { getAllByLabelText, getByText, navigation } = renderScreen(<MapsScreen />, {
      route: { name: 'Maps', params: {} },
    });
    const pin = (await waitFor(() => getAllByLabelText('Alex Rivers, live')))[0];
    fireEvent.press(pin);
    const joinBtn = await waitFor(() => getByText('Join Room'));
    fireEvent.press(joinBtn);
    expect(navigation.navigate).toHaveBeenCalledWith('Main', {
      screen: 'RoomsTab',
      params: { screen: 'Room', params: { roomId: 'r1' } },
    });
  });
});
