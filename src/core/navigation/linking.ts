import { getStateFromPath } from '@react-navigation/native';
import type { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import type { RootStackParamList } from './types';

// Defense-in-depth for the `house/:houseId/invite/:inviteToken?` deep link.
// The invite token arrives in the URL in clear text. Authoritative
// validation (expiry + house membership) MUST happen server-side via the
// accept-invite endpoint, and HouseInvitationScreen must never log it.
// Here we only sanitize the inbound path so a malformed/oversized token can't
// reach the screen: tokens are opaque url-safe identifiers, so we drop any
// invite segment carrying characters outside [A-Za-z0-9._~-] or longer than
// a sane bound. The screen then either gets a clean token or none (the param
// is optional) and stays in charge of surfacing an "invalid invite" state.
const INVITE_PATH = /(\/house\/[^/]+\/invite\/)([^/?#]+)/i;
const SAFE_TOKEN = /^[A-Za-z0-9._~-]{1,256}$/;

const sanitizeInvitePath = (path: string): string =>
  path.replace(INVITE_PATH, (whole, prefix: string, token: string) => {
    const decoded = (() => {
      try {
        return decodeURIComponent(token);
      } catch {
        return token;
      }
    })();
    return SAFE_TOKEN.test(decoded) ? whole : prefix;
  });

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL('/'), 'chathouse://', 'https://app.chathouse.com'],
  // Normalize/sanitize the invite token before the navigator parses params.
  getStateFromPath: (path, options) => getStateFromPath(sanitizeInvitePath(path), options),
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
          SuggestedFollows: 'onboarding/suggested-follows',
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
