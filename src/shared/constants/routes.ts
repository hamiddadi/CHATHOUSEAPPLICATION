/**
 * Centralized route name constants.
 * Prefer these over string literals when navigating.
 */

export const AuthRoutes = {
  WelcomeSlides: 'WelcomeSlides',
  Landing: 'Landing',
  Phone: 'Phone',
  Otp: 'Otp',
  Username: 'Username',
  Waitlist: 'Waitlist',
} as const;

export const OnboardingRoutes = {
  Onboarding: 'Onboarding',
  InterestSelection: 'InterestSelection',
} as const;

export const MainTabs = {
  Rooms: 'RoomsTab',
  Maps: 'MapsTab',
  Messages: 'MessagesTab',
  Settings: 'SettingsTab',
} as const;

export const RoomRoutes = {
  RoomFeed: 'RoomFeed',
  Room: 'Room',
  CreateRoom: 'CreateRoom',
  Profile: 'Profile',
  HouseList: 'HouseList',
  HouseDetail: 'HouseDetail',
  CreateHouse: 'CreateHouse',
  HouseInvitation: 'HouseInvitation',
  InviteMember: 'InviteMember',
  Explore: 'Explore',
  Events: 'Events',
  Notifications: 'Notifications',
} as const;

export const MessageRoutes = {
  MessagesList: 'MessagesList',
  ChatDetail: 'ChatDetail',
} as const;

export const MapRoutes = {
  Maps: 'Maps',
} as const;

export const SettingsRoutes = {
  Settings: 'Settings',
  Profile: 'Profile',
  EditProfile: 'EditProfile',
  Followers: 'Followers',
} as const;

export const RootRoutes = {
  Auth: 'Auth',
  Onboarding: 'Onboarding',
  Main: 'Main',
  RoomModal: 'RoomModal',
  CreateRoomModal: 'CreateRoomModal',
  InviteMemberModal: 'InviteMemberModal',
} as const;
