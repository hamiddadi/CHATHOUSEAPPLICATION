import React from 'react';
import { renderScreen, screen, fireEvent } from '../../../../test-utils/renderScreen';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { useNearbyOnMap } from '../../hooks/useNearbyOnMap';
import { MapsScreen } from './MapsScreen';

jest.mock('../../hooks/useCurrentLocation', () => ({ useCurrentLocation: jest.fn() }));
jest.mock('../../hooks/useNearbyOnMap', () => ({ useNearbyOnMap: jest.fn(() => []) }));
jest.mock('../../hooks/useLocationBroadcast', () => ({ useLocationBroadcast: jest.fn() }));

const mockLocation = useCurrentLocation as jest.Mock;
const mockFollowers = useNearbyOnMap as jest.Mock;

describe('MapsScreen', () => {
  beforeEach(() => {
    mockFollowers.mockReturnValue([]);
  });

  it('renders a permission empty-state when location is denied', () => {
    mockLocation.mockReturnValue({
      permission: 'denied',
      coords: null,
      requestAgain: jest.fn(),
      ready: true,
    });
    renderScreen(<MapsScreen />);
    expect(screen.getByText('Location permission needed')).toBeTruthy();
  });

  it('calls requestAgain when "Grant access" is pressed', () => {
    const requestAgain = jest.fn();
    mockLocation.mockReturnValue({ permission: 'denied', coords: null, requestAgain, ready: true });
    renderScreen(<MapsScreen />);
    fireEvent.press(screen.getByText('Grant access'));
    expect(requestAgain).toHaveBeenCalled();
  });

  it('renders the map with the user location marker once a fix is available', () => {
    mockLocation.mockReturnValue({
      permission: 'granted',
      coords: { latitude: 14.7, longitude: -17.5 },
      requestAgain: jest.fn(),
      ready: true,
    });
    renderScreen(<MapsScreen />);
    expect(screen.getByLabelText('Your location')).toBeTruthy();
  });
});
