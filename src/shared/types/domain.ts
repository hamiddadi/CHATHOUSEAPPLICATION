/**
 * Domain types — shape of entities the backend will return.
 * Mock data in `src/shared/mocks/` must conform to these types.
 * Services/hooks use these as their return shapes.
 */

/* ============================================================
 * User
 * ========================================================== */
export interface User {
  id: string;
  username: string;
  displayName: string;
  // Real name (Clubhouse-style identity), optional and distinct from the
  // public displayName. Backend returns them on the me/public selects.
  firstName?: string | null;
  lastName?: string | null;
  bio: string | null;
  avatarUrl: string | null;
  twitter?: string | null;
  instagram?: string | null;
  followersCount: number;
  followingCount: number;
  isFollowedByMe: boolean;
  isOnline: boolean;
  createdAt: string;
  // Who invited this user (Clubhouse "Nominated by"). Only present on the
  // profile-detail payload; null when the account joined without a referral.
  invitedBy?: { username: string | null; displayName: string | null } | null;
}

export type UserSummary = Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;

/* ============================================================
 * Room (audio)
 * ========================================================== */
export type RoomRole = 'host' | 'moderator' | 'speaker' | 'listener';
export type RoomAudioState = 'speaking' | 'muted' | 'idle';
export type RoomVisibility = 'public' | 'social' | 'closed';
export type RoomCategory = 'tech' | 'design' | 'crypto' | 'ai' | 'music' | 'business' | 'health';

export interface RoomParticipant extends UserSummary {
  role: RoomRole;
  audio: RoomAudioState;
  handRaised: boolean;
}

export interface Room {
  id: string;
  title: string;
  description: string | null;
  category: RoomCategory;
  categoryEmoji: string;
  visibility: RoomVisibility;
  houseId: string | null;
  houseName: string | null;
  houseIcon?: string | null;
  hostId: string;
  speakers: RoomParticipant[];
  listeners: UserSummary[];
  speakersCount: number;
  listenersCount: number;
  participantCount?: number;
  isLive: boolean;
  isRecording: boolean;
  chatEnabled: boolean;
  chatVisibility: 'ALL' | 'MODS_ONLY';
  startedAt: string;
  scheduledFor: string | null;
}

export type RoomSummary = Pick<
  Room,
  'id' | 'title' | 'category' | 'categoryEmoji' | 'houseName' | 'speakersCount' | 'listenersCount'
> & {
  topSpeakers: UserSummary[];
  topListeners: UserSummary[];
  // Optional enrichments (populated by the feed mapper; absent in legacy mocks).
  houseIcon?: string | null;
  participantCount?: number;
  scheduledFor?: string | null;
  isLive?: boolean;
};

/* ============================================================
 * House (community)
 * ========================================================== */
export type HousePrivacy = 'open' | 'private' | 'social';

export interface HouseMember extends UserSummary {
  role: 'admin' | 'moderator' | 'member';
  joinedAt: string;
}

export interface House {
  id: string;
  name: string;
  description: string;
  category: RoomCategory;
  categoryEmoji: string;
  iconUrl: string | null;
  privacy: HousePrivacy;
  /** Owner's userId — used to keep the owner's role immutable in the UI. */
  ownerId: string;
  membersCount: number;
  liveRoomsCount: number;
  isJoinedByMe: boolean;
  members: HouseMember[];
  createdAt: string;
}

export type HouseSummary = Pick<
  House,
  'id' | 'name' | 'category' | 'categoryEmoji' | 'iconUrl' | 'membersCount' | 'privacy'
>;

/* ============================================================
 * Messages / Conversations
 * ========================================================== */
// A text message vs. an async voice note (Clubhouse-style "Chats").
export type MessageKind = 'text' | 'voice';

export interface Message {
  id: string;
  conversationId: string;
  authorId: string;
  // Text body. Empty string for voice notes (use audioUrl + durationMs).
  text: string;
  // 'voice' messages carry a playable audioUrl + clip length; 'text' leaves
  // both null. Defaults to 'text' so legacy mocks/payloads stay valid.
  kind: MessageKind;
  audioUrl: string | null;
  durationMs: number | null;
  sentAt: string;
  isMine: boolean;
}

export interface Conversation {
  id: string;
  participants: UserSummary[];
  lastMessage: Message | null;
  unreadCount: number;
  updatedAt: string;
}

/* ============================================================
 * Notifications
 * ========================================================== */
export type NotificationKind =
  | 'follow'
  | 'room_invite'
  | 'house_invite'
  | 'room_starting'
  | 'mention'
  | 'wave'
  | 'hand_accepted'
  | 'rsvp_reminder'
  | 'new_message';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  actor: UserSummary;
  message: string;
  roomId: string | null;
  houseId: string | null;
  createdAt: string;
  isRead: boolean;
}

/* ============================================================
 * Geo / Presence (Maps feature)
 * ========================================================== */
export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  updatedAt: string;
}

export type PresenceState = 'online' | 'recently_active' | 'offline';

export interface FollowerOnMap extends UserSummary {
  location: GeoPoint;
  presence: PresenceState;
  liveRoomId: string | null;
  liveRoomTitle: string | null;
  /** Minutes since the user was last active. Used for grayscale fade. */
  lastSeenMinutesAgo: number;
}

/* ============================================================
 * Paginated envelope (matches most REST backends)
 * ========================================================== */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}
