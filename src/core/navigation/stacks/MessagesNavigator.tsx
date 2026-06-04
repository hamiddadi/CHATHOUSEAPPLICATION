import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MessageStackParamList } from '../types';
import { colors } from '../../../shared/constants/theme';
import { MessagesScreen } from '../../../features/messages/screens/MessagesScreen';
import { NewMessageScreen } from '../../../features/messages/screens/NewMessageScreen';
import { ChatDetailScreen } from '../../../features/messages/screens/ChatDetailScreen';
import { GroupChatScreen } from '../../../features/messages/screens/GroupChatScreen';
import { GroupInfoScreen } from '../../../features/messages/screens/GroupInfoScreen';
import { AddGroupMembersScreen } from '../../../features/messages/screens/AddGroupMembersScreen';

const Stack = createNativeStackNavigator<MessageStackParamList>();

export const MessagesNavigator: React.FC = () => (
  <Stack.Navigator
    initialRouteName="MessagesList"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.background },
    }}
  >
    <Stack.Screen name="MessagesList" component={MessagesScreen} />
    <Stack.Screen name="NewMessage" component={NewMessageScreen} />
    <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
    <Stack.Screen name="GroupChat" component={GroupChatScreen} />
    <Stack.Screen name="GroupInfo" component={GroupInfoScreen} />
    <Stack.Screen name="AddGroupMembers" component={AddGroupMembersScreen} />
  </Stack.Navigator>
);
