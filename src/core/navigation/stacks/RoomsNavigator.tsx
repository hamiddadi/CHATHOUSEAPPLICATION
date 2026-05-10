import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RoomStackParamList } from '../types';
import { colors } from '../../../shared/constants/theme';
import { RoomFeedScreen } from '../../../features/rooms/screens/RoomFeedScreen';
import { RoomScreen } from '../../../features/rooms/screens/RoomScreen';
import { CreateRoomScreen } from '../../../features/rooms/screens/CreateRoomScreen';
import { InviteToRoomScreen } from '../../../features/rooms/screens/InviteToRoomScreen';
import { ProfileScreen } from '../../../features/profile/screens/ProfileScreen';
import { HouseListScreen } from '../../../features/houses/screens/HouseListScreen';
import { HouseDetailScreen } from '../../../features/houses/screens/HouseDetailScreen';
import { CreateHouseScreen } from '../../../features/houses/screens/CreateHouseScreen';
import { HouseInvitationScreen } from '../../../features/houses/screens/HouseInvitationScreen';
import { InviteMemberScreen } from '../../../features/houses/screens/InviteMemberScreen';
import { ExploreScreen } from '../../../features/search/screens/ExploreScreen';
import { EventsScreen } from '../../../features/events/screens/EventsScreen';
import { NotificationsScreen } from '../../../features/notifications/screens/NotificationsScreen';

const Stack = createNativeStackNavigator<RoomStackParamList>();

export const RoomsNavigator: React.FC = () => (
  <Stack.Navigator
    initialRouteName="RoomFeed"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.background },
    }}
  >
    <Stack.Screen name="RoomFeed" component={RoomFeedScreen} />
    <Stack.Screen name="Room" component={RoomScreen} />
    <Stack.Screen
      name="CreateRoom"
      component={CreateRoomScreen}
      options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
    />
    <Stack.Screen
      name="InviteToRoom"
      component={InviteToRoomScreen}
      options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
    />
    <Stack.Screen name="Profile" component={ProfileScreen} />

    {/* Houses — reachable from a room's house badge or the feed header. */}
    <Stack.Screen name="HouseList" component={HouseListScreen} />
    <Stack.Screen name="HouseDetail" component={HouseDetailScreen} />
    <Stack.Screen
      name="CreateHouse"
      component={CreateHouseScreen}
      options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
    />
    <Stack.Screen name="HouseInvitation" component={HouseInvitationScreen} />
    <Stack.Screen
      name="InviteMember"
      component={InviteMemberScreen}
      options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
    />

    {/* Module follow-up surfaces — reachable from the RoomFeed header. */}
    <Stack.Screen name="Explore" component={ExploreScreen} />
    <Stack.Screen name="Events" component={EventsScreen} />
    <Stack.Screen name="Notifications" component={NotificationsScreen} />
  </Stack.Navigator>
);
