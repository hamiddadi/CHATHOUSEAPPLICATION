import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MessageStackParamList } from '../types';
import { colors } from '../../../shared/constants/theme';
import { MessagesScreen } from '../../../features/messages/screens/MessagesScreen';
import { ChatDetailScreen } from '../../../features/messages/screens/ChatDetailScreen';

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
    <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
  </Stack.Navigator>
);
