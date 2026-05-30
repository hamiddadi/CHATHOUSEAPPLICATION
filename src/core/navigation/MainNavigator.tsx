import React from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute, type RouteProp } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { colors, layout, radii, shadows, spacing } from '../../shared/constants/theme';
import { useUnreadMessageCount } from '../../features/messages/hooks/useMessages';
import { useChatSocket } from '../../features/messages/hooks/useChatSocket';
import { useNotificationSocket } from '../../features/notifications/hooks/useNotificationSocket';
import { RoomMiniBar } from '../../shared/components/RoomMiniBar';
import type { MainTabParamList } from './types';
import { RoomsNavigator } from './stacks/RoomsNavigator';
import { MapsNavigator } from './stacks/MapsNavigator';
import { MessagesNavigator } from './stacks/MessagesNavigator';
import { SettingsNavigator } from './stacks/SettingsNavigator';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Floating bottom tab bar — matches the reference mocks (4 tabs: mic/map/chat/settings).
 * BlurView sits behind to produce the glass effect; the wrapping View floats above the content
 * with a rounded pill container.
 */
const renderTabBarBackground = () => (
  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {Platform.OS === 'ios' ? (
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
    ) : (
      <View style={[StyleSheet.absoluteFill, styles.androidTabBg]} />
    )}
  </View>
);

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

const TabIcon: React.FC<{ name: IconName; color: string; size: number }> = ({
  name,
  color,
  size,
}) => <MaterialIcons name={name} size={size} color={color} />;

const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: string; size: number }) => (
    <TabIcon name={name} color={color} size={size} />
  );

/**
 * Messages tab icon with an unread-DM badge. Reading the count inside
 * a dedicated component (instead of React Navigation's `tabBarBadge`)
 * gives us custom styling plus live updates via React Query cache —
 * `useChatSocket` invalidates this hook whenever a new DM arrives.
 */
const MessagesTabIcon: React.FC<{ color: string; size: number }> = ({ color, size }) => {
  const { data: unread = 0 } = useUnreadMessageCount();
  return (
    <View>
      <MaterialIcons name="chat-bubble-outline" size={size} color={color} />
      {unread > 0 && (
        <View style={styles.badge} accessibilityLabel={`${unread} unread messages`}>
          <Text style={styles.badgeLabel}>{unread > 99 ? '99+' : String(unread)}</Text>
        </View>
      )}
    </View>
  );
};

const messagesTabIcon = ({ color, size }: { color: string; size: number }) => (
  <MessagesTabIcon color={color} size={size} />
);

const HIDDEN_TAB_BAR_ROUTES = new Set<string>(['ChatDetail']);

const resolveTabBarStyle = (
  route: RouteProp<MainTabParamList, keyof MainTabParamList>,
): StyleProp<ViewStyle> => {
  const focused = getFocusedRouteNameFromRoute(route);
  if (focused && HIDDEN_TAB_BAR_ROUTES.has(focused)) {
    return { display: 'none' };
  }
  return styles.tabBar;
};

export const MainNavigator: React.FC = () => {
  // Subscribe to chat:message / chat:read at the nav level so the
  // Messages tab badge refreshes even when the user is on another tab
  // or inside a room. Idempotent — the underlying socket is a singleton.
  useChatSocket();
  // Same idea for notification:new / notification:count → keeps the
  // Notifications badge + list live without polling.
  useNotificationSocket();
  return (
    <View style={styles.container}>
      <Tab.Navigator
        initialRouteName="RoomsTab"
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.outline,
          tabBarBackground: renderTabBarBackground,
          tabBarStyle: styles.tabBar,
          tabBarItemStyle: styles.tabItem,
        }}
      >
        <Tab.Screen
          name="RoomsTab"
          component={RoomsNavigator}
          options={{ tabBarIcon: tabIcon('mic') }}
        />
        <Tab.Screen
          name="MapsTab"
          component={MapsNavigator}
          options={{ tabBarIcon: tabIcon('map') }}
        />
        <Tab.Screen
          name="MessagesTab"
          component={MessagesNavigator}
          options={({ route }) => ({
            tabBarIcon: messagesTabIcon,
            tabBarStyle: resolveTabBarStyle(route),
          })}
        />
        <Tab.Screen
          name="SettingsTab"
          component={SettingsNavigator}
          options={{ tabBarIcon: tabIcon('settings') }}
        />
      </Tab.Navigator>
      <RoomMiniBar />
    </View>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: '5%',
    right: '5%',
    bottom: layout.tabBarBottomOffset,
    height: layout.tabBarHeight,
    borderRadius: radii.xxxl,
    borderTopWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    paddingHorizontal: spacing.xxl,
    ...shadows.lg,
  },
  tabItem: {
    paddingVertical: spacing.md,
  },
  androidTabBg: {
    backgroundColor: 'rgba(7,11,40,0.92)',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    color: colors.background,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  container: { flex: 1 },
});
