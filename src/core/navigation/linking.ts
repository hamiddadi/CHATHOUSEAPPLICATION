import type { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import type { RootStackParamList } from './types';

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'chathouse://', 'https://app.chathouse.com'],
  config: {
    screens: {
      Auth: {
        screens: {
          Landing: 'landing',
          Phone: 'auth/phone',
          Otp: 'auth/otp',
          Username: 'auth/username',
          Waitlist: 'auth/waitlist',
        },
      },
      Onboarding: {
        screens: {
          Onboarding: 'onboarding',
          InterestSelection: 'onboarding/interests',
        },
      },
      Main: {
        screens: {
          RoomsTab: {
            screens: {
              RoomFeed: 'rooms',
              Room: 'room/:roomId',
              CreateRoom: 'room/new',
              Profile: 'u/:userId',
              HouseList: 'houses',
              HouseDetail: 'house/:houseId',
              CreateHouse: 'house/new',
              HouseInvitation: 'house/:houseId/invite/:inviteToken?',
              InviteMember: 'house/:houseId/invite-member',
            },
          },
          MapsTab: { screens: { Maps: 'map' } },
          MessagesTab: {
            screens: {
              MessagesList: 'messages',
              ChatDetail: 'chat/:conversationId',
            },
          },
          SettingsTab: {
            screens: {
              Settings: 'settings',
              Profile: 'settings/profile/:userId?',
              EditProfile: 'settings/edit',
              Followers: 'settings/followers/:userId',
            },
          },
        },
      },
      RoomModal: 'modal/room/:roomId',
      CreateRoomModal: 'modal/create-room',
      InviteMemberModal: 'modal/invite/:houseId',
    },
  },
};
