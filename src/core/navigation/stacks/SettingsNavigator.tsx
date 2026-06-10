import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../types';
import { colors } from '../../../shared/constants/theme';
import { SettingsScreen } from '../../../features/settings/screens/SettingsScreen';
import { NotificationSettingsScreen } from '../../../features/settings/screens/NotificationSettingsScreen';
import { ProfileScreen } from '../../../features/profile/screens/ProfileScreen';
import { EditProfileScreen } from '../../../features/profile/screens/EditProfileScreen';
import { FollowersScreen } from '../../../features/profile/screens/FollowersScreen';
import {
  AdminAuditLogScreen,
  AdminHomeScreen,
  AdminReportsScreen,
  AdminRoomsScreen,
  AdminUserDetailScreen,
  AdminUsersScreen,
} from '../../../features/admin';
import {
  DataExportScreen,
  DeleteAccountScreen,
  PrivacyPolicyScreen,
  TermsScreen,
} from '../../../features/privacy';
import { ExtSettingsScreen } from '../../../features/extensions';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export const SettingsNavigator: React.FC = () => (
  <Stack.Navigator
    initialRouteName="Settings"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: colors.background },
    }}
  >
    <Stack.Screen name="Settings" component={SettingsScreen} />
    <Stack.Screen name="Profile" component={ProfileScreen} />
    <Stack.Screen name="EditProfile" component={EditProfileScreen} />
    <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    <Stack.Screen name="Followers" component={FollowersScreen} />
    {/* Godmode — registered globally; the entry in SettingsScreen is the
        UX gate (only rendered for moderator+). The screens themselves
        re-check role server-side via /api/admin/me, so a deep-link is
        rejected with 403 if the user lost privileges. */}
    <Stack.Screen name="AdminHome" component={AdminHomeScreen} />
    <Stack.Screen name="AdminUsers" component={AdminUsersScreen} />
    <Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} />
    <Stack.Screen name="AdminReports" component={AdminReportsScreen} />
    <Stack.Screen name="AdminRooms" component={AdminRoomsScreen} />
    <Stack.Screen name="AdminAuditLog" component={AdminAuditLogScreen} />
    {/* GDPR — accessible to every authed user, even non-admins. */}
    <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
    <Stack.Screen name="Terms" component={TermsScreen} />
    <Stack.Screen name="DataExport" component={DataExportScreen} />
    <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />

    {/* Extension settings (Phase 1) */}
    <Stack.Screen name="ExtSettings" component={ExtSettingsScreen} />
  </Stack.Navigator>
);
