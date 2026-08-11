import React, { useCallback } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RoomStackParamList } from '../types';
import { colors } from '../../../shared/constants/theme';
import { RoomFeedScreen } from '../../../features/rooms/screens/RoomFeedScreen';
import { RoomScreen } from '../../../features/rooms/screens/RoomScreen';
import { CreateRoomScreen } from '../../../features/rooms/screens/CreateRoomScreen';
import { InviteToRoomScreen } from '../../../features/rooms/screens/InviteToRoomScreen';
import { ProfileScreen } from '../../../features/profile/screens/ProfileScreen';
import { EditProfileScreen } from '../../../features/profile/screens/EditProfileScreen';
import { HouseListScreen } from '../../../features/houses/screens/HouseListScreen';
import { HouseDetailScreen } from '../../../features/houses/screens/HouseDetailScreen';
import { CreateHouseScreen } from '../../../features/houses/screens/CreateHouseScreen';
import { HouseInvitationScreen } from '../../../features/houses/screens/HouseInvitationScreen';
import { InviteMemberScreen } from '../../../features/houses/screens/InviteMemberScreen';
import { ManageHouseScreen } from '../../../features/houses/screens/ManageHouseScreen';
import { ExploreScreen } from '../../../features/search/screens/ExploreScreen';
import { EventsScreen } from '../../../features/events/screens/EventsScreen';
import { NotificationsScreen } from '../../../features/notifications/screens/NotificationsScreen';
import { FollowRequestsScreen } from '../../../features/notifications/screens/FollowRequestsScreen';
import { ExtTopicExplorerScreen, ExtActivityFeedScreen } from '../../../features/extensions';
import type { ActivityItem } from '../../../features/extensions';

const Stack = createNativeStackNavigator<RoomStackParamList>();

type RoomsNav = NativeStackNavigationProp<RoomStackParamList>;

/**
 * Wrapper mounting the (otherwise standalone) activity feed with a real
 * `onTapItem` that routes each notification to its target screen. The screen
 * still marks the row read on tap; this only adds the navigation side-effect.
 */
const ActivityFeedRoute: React.FC = () => {
  const navigation = useNavigation<RoomsNav>();
  const onTapItem = useCallback(
    (item: ActivityItem) => {
      if (!item.targetId) return;
      switch (item.targetType) {
        case 'room':
          navigation.navigate('Room', { roomId: item.targetId });
          break;
        case 'user':
          navigation.navigate('Profile', { userId: item.targetId });
          break;
        case 'club':
          navigation.navigate('HouseDetail', { houseId: item.targetId });
          break;
        default:
          // Unknown target type — leave the tap as a plain mark-read no-op.
          break;
      }
    },
    [navigation],
  );
  return <ExtActivityFeedScreen onTapItem={onTapItem} />;
};

/**
 * Wrapper mounting the topic explorer with a real `onSelectTopic` that opens
 * the Explore screen filtered by the chosen topic slug. Also forwards an
 * optional `initialTopic` route param through so a caller (e.g. Explore) can
 * pre-select a topic when opening the explorer.
 */
const TopicExplorerRoute: React.FC = () => {
  const navigation = useNavigation<RoomsNav>();
  const route = useRoute<RouteProp<RoomStackParamList, 'TopicExplorer'>>();
  const onSelectTopic = useCallback(
    (slug: string) => {
      navigation.navigate('Explore', { topic: slug });
    },
    [navigation],
  );
  return (
    <ExtTopicExplorerScreen
      onSelectTopic={onSelectTopic}
      initialTopic={route.params?.initialTopic}
    />
  );
};

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
    {/* Registered so "edit profile" from a self-profile opened in the Rooms
        tab keeps the user in-tab (no cross-tab jump to Settings). */}
    <Stack.Screen name="EditProfile" component={EditProfileScreen} />

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
    <Stack.Screen
      name="ManageHouse"
      component={ManageHouseScreen}
      options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
    />

    {/* Module follow-up surfaces — reachable from the RoomFeed header. */}
    <Stack.Screen name="Explore" component={ExploreScreen} />
    <Stack.Screen name="Events" component={EventsScreen} />
    <Stack.Screen name="Notifications" component={NotificationsScreen} />
    <Stack.Screen name="FollowRequests" component={FollowRequestsScreen} />

    {/* Extension screens (Phase 1) — wrapped so taps actually navigate. */}
    <Stack.Screen name="TopicExplorer" component={TopicExplorerRoute} />
    <Stack.Screen name="ActivityFeed" component={ActivityFeedRoute} />
  </Stack.Navigator>
);
