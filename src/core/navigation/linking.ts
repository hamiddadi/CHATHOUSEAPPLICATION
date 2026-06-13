import { getStateFromPath } from '@react-navigation/native';
import type { LinkingOptions } from '@react-navigation/native';
import { useInviteStore } from '../../features/extensions/store/inviteStore';
import type { RootStackParamList } from './types';

// Referral deep link: `…/invite/<code>` where <code> = <base64url>.<sig>.
// We capture the code into the invite store (redeemed after onboarding) and
// then let navigation fall through to the default screen rather than routing
// to a dedicated invite screen — so an authenticated user isn't bounced to a
// pre-auth route, and a new user lands on the normal Landing/onboarding flow.
const CAPTURE_INVITE = /(?:^|\/)invite\/([^/?#]+)/i;
// Codes are url-safe base64url with a single '.' separator. Bound the length.
const SAFE_INVITE_CODE = /^[A-Za-z0-9._~-]{1,512}$/;

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
  prefixes: ['chathouse://', 'https://app.chathouse.com'],
  // Normalize/sanitize the invite token before the navigator parses params.
  getStateFromPath: (path, options) => {
    // Referral link → stash the code for post-onboarding redemption, then fall
    // through to the default screen (no explicit navigation target).
    const inviteCode = path.match(CAPTURE_INVITE)?.[1];
    if (inviteCode && SAFE_INVITE_CODE.test(inviteCode)) {
      useInviteStore.getState().setPendingCode(inviteCode);
      return undefined;
    }
    return getStateFromPath(sanitizeInvitePath(path), options);
  },
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
          NotificationsPermission: 'onboarding/notifications',
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
              NewMessage: 'messages/new',
              ChatDetail: 'chat/:conversationId',
              GroupChat: 'group/:conversationId',
              GroupInfo: 'group/:conversationId/info',
              AddGroupMembers: 'group/:conversationId/add',
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
