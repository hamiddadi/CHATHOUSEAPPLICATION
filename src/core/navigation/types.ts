import type { NavigatorScreenParams, CompositeScreenProps } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

/* ============================================================
 * AUTH STACK
 * ========================================================== */
export type AuthStackParamList = {
  WelcomeSlides: undefined;
  Landing: undefined;
  Phone: undefined;
  Otp: { phoneNumber: string };
  Username: { phoneNumber: string };
  Waitlist: undefined;
};
export type AuthStackScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;

/** Navigation prop only (no route) — for screens that just need `.navigate(...)`. */
export type LandingNavProp = NativeStackNavigationProp<AuthStackParamList, 'Landing'>;

/* ============================================================
 * ONBOARDING STACK
 * ========================================================== */
export type OnboardingStackParamList = {
  Onboarding: undefined;
  InterestSelection: undefined;
};
export type OnboardingStackScreenProps<T extends keyof OnboardingStackParamList> =
  NativeStackScreenProps<OnboardingStackParamList, T>;

/* ============================================================
 * FEATURE STACKS
 * ========================================================== */
export type RoomStackParamList = {
  RoomFeed: undefined;
  Room: { roomId: string };
  CreateRoom: undefined;
  Profile: { userId: string };

  // House screens live here so they are reachable from the Rooms tab.
  HouseList: undefined;
  HouseDetail: { houseId: string };
  CreateHouse: undefined;
  HouseInvitation: { houseId: string; inviteToken?: string };
  InviteMember: { houseId: string };

  // Module-follow-up screens (Module 3/4/6 surfaces).
  Explore: undefined;
  Events: undefined;
  Notifications: undefined;

  // In-room: invite multiple followers/contacts to join the current room.
  InviteToRoom: { roomId: string };
};

export type MessageStackParamList = {
  MessagesList: undefined;
  ChatDetail: { conversationId: string };
};

export type MapStackParamList = {
  Maps: undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
  Profile: { userId?: string } | undefined;
  EditProfile: undefined;
  Followers: { userId: string; initialTab?: 'followers' | 'following' };

  // Godmode — gated by appRole >= MODERATOR. The entry point in Settings
  // only renders when whoami() reports a privileged role.
  AdminHome: undefined;
  AdminUsers: undefined;
  AdminUserDetail: { userId: string };
  AdminReports: undefined;
  AdminRooms: undefined;
  AdminAuditLog: undefined;

  // GDPR / privacy — accessible to every authed user.
  PrivacyPolicy: undefined;
  Terms: undefined;
  DataExport: undefined;
  DeleteAccount: undefined;
};

/* ============================================================
 * MAIN BOTTOM TABS (4 tabs per design: mic / map / chat / settings)
 * ========================================================== */
export type MainTabParamList = {
  RoomsTab: NavigatorScreenParams<RoomStackParamList>;
  MapsTab: NavigatorScreenParams<MapStackParamList>;
  MessagesTab: NavigatorScreenParams<MessageStackParamList>;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList>;
};
export type MainTabScreenProps<T extends keyof MainTabParamList> = BottomTabScreenProps<
  MainTabParamList,
  T
>;

/* ============================================================
 * ROOT
 * ========================================================== */
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;

  // Top-level modals (presented above tabs)
  RoomModal: { roomId: string };
  CreateRoomModal: undefined;
  InviteMemberModal: { houseId: string };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

/* ============================================================
 * COMPOSITE HELPERS — use in screens that need tab + root awareness
 * ========================================================== */
export type RoomStackScreenProps<T extends keyof RoomStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<RoomStackParamList, T>,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList>,
    RootStackScreenProps<keyof RootStackParamList>
  >
>;

export type SettingsStackScreenProps<T extends keyof SettingsStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<SettingsStackParamList, T>,
  CompositeScreenProps<
    BottomTabScreenProps<MainTabParamList>,
    RootStackScreenProps<keyof RootStackParamList>
  >
>;

// React Navigation's canonical module augmentation pattern requires both a namespace
// and an empty interface extending RootStackParamList.
// Lint exceptions for this file live in .eslintrc.js `overrides`.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
