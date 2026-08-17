import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import en from '../i18n/locales/en.json';
import fr from '../i18n/locales/fr.json';
import { MainNavigator } from './MainNavigator';

type CapturedOptions = {
  tabBarAccessibilityLabel?: string;
  tabBarIcon?: (props: { color: string; size: number }) => React.ReactNode;
  tabBarStyle?: unknown;
};

type CapturedRoute = {
  key: string;
  name: string;
  state?: { index: number; routes: Array<{ key: string; name: string }> };
};

type CapturedScreen = {
  name: string;
  options?: CapturedOptions | ((args: { route: CapturedRoute }) => CapturedOptions);
};

const mockTabScreens: CapturedScreen[] = [];
let mockUnreadCount = 0;

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
  useUnreadMessageCount: () => ({ data: mockUnreadCount }),
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

const resolveOptions = (screenName: string, focusedRouteName?: string): CapturedOptions => {
  const screen = mockTabScreens.find(({ name }) => name === screenName);
  if (!screen?.options) {
    throw new Error(`No options captured for ${screenName}`);
  }

  const route: CapturedRoute = { key: `${screenName}-key`, name: screenName };
  if (focusedRouteName) {
    route.state = {
      index: 0,
      routes: [{ key: `${focusedRouteName}-key`, name: focusedRouteName }],
    };
  }

  return typeof screen.options === 'function' ? screen.options({ route }) : screen.options;
};

describe('MainNavigator accessibility', () => {
  beforeEach(() => {
    mockTabScreens.length = 0;
    mockUnreadCount = 0;
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

  it('applies secondary-route tab-bar hiding to every tab stack', () => {
    render(<MainNavigator />);

    expect(resolveOptions('RoomsTab', 'CreateRoom').tabBarStyle).toEqual({ display: 'none' });
    expect(resolveOptions('MapsTab', 'Profile').tabBarStyle).toEqual({ display: 'none' });
    expect(resolveOptions('MessagesTab', 'ChatDetail').tabBarStyle).toEqual({ display: 'none' });
    expect(resolveOptions('SettingsTab', 'PrivacyPolicy').tabBarStyle).toEqual({
      display: 'none',
    });
  });

  it('lets the unread badge grow without clipping its compact numeric label', () => {
    mockUnreadCount = 120;
    render(<MainNavigator />);

    const icon = resolveOptions('MessagesTab').tabBarIcon?.({ color: '#fff', size: 24 });
    if (!React.isValidElement(icon)) {
      throw new Error('Messages tab icon was not captured');
    }

    const { getByLabelText, getByText } = render(icon);
    const label = getByText('99+');
    const badge = getByLabelText('120 unread messages');
    expect(label.props.allowFontScaling).toBe(false);
    expect(label.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(badge.props.style)).toMatchObject({ minHeight: 16 });
    expect(StyleSheet.flatten(badge.props.style)).not.toHaveProperty('height');
  });
});
