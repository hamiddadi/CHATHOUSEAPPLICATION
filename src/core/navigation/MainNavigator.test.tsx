import React from 'react';
import { render } from '@testing-library/react-native';
import en from '../i18n/locales/en.json';
import fr from '../i18n/locales/fr.json';
import { MainNavigator } from './MainNavigator';

type CapturedOptions = {
  tabBarAccessibilityLabel?: string;
};

type CapturedScreen = {
  name: string;
  options?: CapturedOptions | ((args: { route: { key: string; name: string } }) => CapturedOptions);
};

const mockTabScreens: CapturedScreen[] = [];

jest.mock('@react-navigation/bottom-tabs', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  return {
    createBottomTabNavigator: () => ({
      Navigator: ({ children }: { children?: React.ReactNode }) =>
        ReactActual.createElement(ReactActual.Fragment, null, children),
      Screen: (props: CapturedScreen) => {
        mockTabScreens.push(props);
        return null;
      },
    }),
  };
});

jest.mock('../../features/messages/hooks/useMessages', () => ({
  useUnreadMessageCount: () => ({ data: 0 }),
}));
jest.mock('../../features/messages/hooks/useChatSocket', () => ({
  useChatSocket: jest.fn(),
}));
jest.mock('../../features/notifications/hooks/useNotificationSocket', () => ({
  useNotificationSocket: jest.fn(),
}));
jest.mock('../../features/profile/hooks/useFollowerCountSocket', () => ({
  useFollowerCountSocket: jest.fn(),
}));
jest.mock('../../shared/components/RoomMiniBar', () => ({
  RoomMiniBar: () => null,
}));
jest.mock('./stacks/RoomsNavigator', () => ({
  RoomsNavigator: () => null,
}));
jest.mock('./stacks/MapsNavigator', () => ({
  MapsNavigator: () => null,
}));
jest.mock('./stacks/MessagesNavigator', () => ({
  MessagesNavigator: () => null,
}));
jest.mock('./stacks/SettingsNavigator', () => ({
  SettingsNavigator: () => null,
}));

const resolveOptions = (screenName: string): CapturedOptions => {
  const screen = mockTabScreens.find(({ name }) => name === screenName);
  if (!screen?.options) {
    throw new Error(`No options captured for ${screenName}`);
  }

  return typeof screen.options === 'function'
    ? screen.options({ route: { key: `${screenName}-key`, name: screenName } })
    : screen.options;
};

describe('MainNavigator accessibility', () => {
  beforeEach(() => {
    mockTabScreens.length = 0;
  });

  it('gives every icon-only tab a localized accessible name', () => {
    render(<MainNavigator />);

    expect(resolveOptions('RoomsTab').tabBarAccessibilityLabel).toBe(en.navigation.tabs.rooms);
    expect(resolveOptions('MapsTab').tabBarAccessibilityLabel).toBe(en.navigation.tabs.map);
    expect(resolveOptions('MessagesTab').tabBarAccessibilityLabel).toBe(
      en.navigation.tabs.messages,
    );
    expect(resolveOptions('SettingsTab').tabBarAccessibilityLabel).toBe(
      en.navigation.tabs.settings,
    );
  });

  it('keeps matching French labels for every main tab', () => {
    expect(Object.keys(fr.navigation.tabs)).toEqual(Object.keys(en.navigation.tabs));
    expect(fr.navigation.tabs).toEqual({
      rooms: 'Rooms',
      map: 'Carte',
      messages: 'Messages',
      settings: 'Paramètres',
    });
  });
});
