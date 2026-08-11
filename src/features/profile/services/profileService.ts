import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { DmPrivacy, User, UserSummary } from '../../../shared/types/domain';

export interface ProfileViewer {
  viewedAt: string;
  user: UserSummary;
}

// Shape returned by GET /api/users/me, PATCH /api/users/me and
// GET /api/users/:id. The two backend selects (`meSelect`/`publicSelect`)
// overlap on every field we read here; the extra `me`-only fields are
// ignored. We narrow to optional/nullable so the same mapper covers both.
interface RawUser {
  id: string;
  username: string | null;
  displayName: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl: string | null;
  bio: string | null;
  twitter?: string | null;
  instagram?: string | null;
  isOnline?: boolean;
  followerCount?: number;
  followingCount?: number;
  isFollowedByMe?: boolean;
  followRequestedByMe?: boolean;
  createdAt?: string;
  // Inviter relation — only on the detail payload (GET /users/:id).
  invitedBy?: { id: string; username: string | null; displayName: string | null } | null;
  // Live room the user is currently in (publicSelect), or null when idle.
  currentRoomId?: string | null;
  // DM privacy (#114) — only on the `me` payload (meSelect).
  dmPrivacy?: 'everyone' | 'followers' | 'mutual' | 'nobody';
}

// Shape returned by GET /api/users/search and the follow list endpoints
// (publicUser select) — narrower than the full User domain type. We fill
// the remaining fields with safe defaults so the hook's `User[]` return
// type stays intact.
interface RawSearchUser {
  id: string;
  username: string | null;
  displayName: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isOnline?: boolean;
  createdAt?: string;
  // Follow-list endpoints now stamp this per-viewer so the Follow/Following
  // toggle is correct. Optional: search payloads still omit it.
  isFollowedByMe?: boolean;
  followRequestedByMe?: boolean;
  // The authenticated viewer's following list includes this server-computed
  // privacy result. Search/profile payloads deliberately omit it.
  canDirectMessage?: boolean;
}

// Follow list endpoints return a paginated envelope: { data, nextCursor,
// hasMore }. New cursors are opaque `(createdAt,id)` values; pass them back
// unchanged as `cursor` (legacy ISO values remain accepted by the backend).
interface RawFollowList {
  data: RawSearchUser[];
  nextCursor: string | null;
  hasMore?: boolean;
}

// A mapped page of a follow list, surfaced to the hooks (useInfiniteQuery).
// `items` is the domain shape; `nextCursor` is null on the last page.
export interface FollowPage {
  items: User[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Fields shared by `mapUser` and `mapSummary`: the username/displayName/
// createdAt normalization is identical for both payload shapes.
const mapBaseUser = (
  u: RawUser | RawSearchUser,
): Pick<
  User,
  | 'id'
  | 'username'
  | 'displayName'
  | 'firstName'
  | 'lastName'
  | 'avatarUrl'
  | 'bio'
  | 'twitter'
  | 'instagram'
  | 'isOnline'
  | 'createdAt'
> => ({
  id: u.id,
  username: u.username ?? '',
  displayName: u.displayName ?? u.username ?? '',
  firstName: u.firstName ?? null,
  lastName: u.lastName ?? null,
  avatarUrl: u.avatarUrl,
  bio: u.bio,
  // Social handles only ride on the detail payload (RawUser). The search/
  // follow-list payload (RawSearchUser) omits them, so guard with `in` and
  // fall back to null there.
  twitter: 'twitter' in u ? (u.twitter ?? null) : null,
  instagram: 'instagram' in u ? (u.instagram ?? null) : null,
  isOnline: u.isOnline ?? false,
  createdAt: u.createdAt ?? new Date().toISOString(),
});

const mapUser = (u: RawUser): User => ({
  ...mapBaseUser(u),
  // Backend denormalizes follower/following counts as `followerCount`
  // (singular); the domain type uses `followersCount`.
  followersCount: u.followerCount ?? 0,
  followingCount: u.followingCount ?? 0,
  invitedBy: u.invitedBy
    ? { username: u.invitedBy.username, displayName: u.invitedBy.displayName }
    : null,
  // GET /users/:id now returns `isFollowedByMe` per-viewer (derived from the
  // Follow table). GET /users/me omits it (you don't follow yourself) → the
  // ?? false default applies there, which is correct.
  isFollowedByMe: u.isFollowedByMe ?? false,
  followRequestedByMe: u.followRequestedByMe ?? false,
  currentRoomId: u.currentRoomId ?? null,
  dmPrivacy: u.dmPrivacy,
});

const mapSummary = (u: RawSearchUser): User => ({
  ...mapBaseUser(u),
  // These counts aren't part of the list payload (they'd require an N+1
  // lookup). Callers that need them should fetch the user detail via
  // `get(userId)`.
  followersCount: 0,
  followingCount: 0,
  // Follow-list endpoints stamp isFollowedByMe per-viewer; search payloads
  // omit it → default false. Hardcoding false made the FollowersScreen toggle
  // always show "Follow" (and re-follow instead of unfollow).
  isFollowedByMe: u.isFollowedByMe ?? false,
  followRequestedByMe: u.followRequestedByMe ?? false,
  canDirectMessage: u.canDirectMessage,
});

export interface UpdateProfileInput {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  bio?: string;
  avatarUrl?: string | null;
  twitter?: string;
  instagram?: string;
  dmPrivacy?: DmPrivacy;
}

export const profileService = {
  async me(): Promise<User> {
    const res = await apiClient.get<Envelope<RawUser>>('/users/me');
    return mapUser(res.data.data);
  },

  async get(userId: string): Promise<User> {
    const res = await apiClient.get<Envelope<RawUser>>(`/users/${userId}`);
    return mapUser(res.data.data);
  },

  // #76: who recently viewed my profile (premium — 403s otherwise).
  async profileViewers(): Promise<ProfileViewer[]> {
    const res =
      await apiClient.get<Envelope<{ viewedAt: string; user: RawSearchUser }[]>>(
        '/users/me/profile-views',
      );
    return res.data.data.map(r => ({
      viewedAt: r.viewedAt,
      user: {
        id: r.user.id,
        username: r.user.username ?? '',
        displayName: r.user.displayName ?? r.user.username ?? '',
        avatarUrl: r.user.avatarUrl,
      },
    }));
  },

  async update(input: UpdateProfileInput): Promise<User> {
    // Username FIRST (audit QA 2026-07-02): it rides a dedicated endpoint
    // with its own uniqueness check (409 USER_002). Sending it before the
    // profile PATCH keeps the common failure mode (handle already taken)
    // all-or-nothing instead of leaving the other fields silently saved.
    // Callers must omit `username` when it hasn't changed, otherwise the
    // backend may reject a no-op rename against the user's own handle.
    const nextUsername = input.username?.trim();
    if (nextUsername) {
      await apiClient.patch<Envelope<RawUser>>('/users/me/username', {
        username: nextUsername,
      });
    }

    // PATCH /users/me is `.strict()` and only accepts displayName/bio/
    // avatarUrl — `username` lives on a dedicated endpoint. Omit undefined
    // keys so we never send a key the schema would reject, and skip
    // avatarUrl when it isn't a remote URL (the schema requires a valid
    // URL; local ImagePicker `file://` URIs must be uploaded first).
    const body: {
      displayName?: string;
      firstName?: string;
      lastName?: string;
      bio?: string;
      avatarUrl?: string;
      twitter?: string;
      instagram?: string;
      dmPrivacy?: DmPrivacy;
    } = {};
    if (input.dmPrivacy !== undefined) body.dmPrivacy = input.dmPrivacy;
    if (input.displayName !== undefined) body.displayName = input.displayName.trim();
    if (input.firstName !== undefined) body.firstName = input.firstName.trim();
    if (input.lastName !== undefined) body.lastName = input.lastName.trim();
    if (input.bio !== undefined) body.bio = input.bio.trim();
    // Social handles are plain text. Trim and strip a leading '@' so the stored
    // value stays bare; an empty string clears the handle. The backend
    // re-strips '@' defensively (max 50).
    if (input.twitter !== undefined) body.twitter = input.twitter.trim().replace(/^@+/, '');
    if (input.instagram !== undefined) body.instagram = input.instagram.trim().replace(/^@+/, '');
    if (typeof input.avatarUrl === 'string' && /^https?:\/\//i.test(input.avatarUrl)) {
      body.avatarUrl = input.avatarUrl;
    }
    // Runs after the username PATCH, so the response already reflects the
    // fresh handle — safe to return as the single source of truth.
    const res = await apiClient.patch<Envelope<RawUser>>('/users/me', body);
    return mapUser(res.data.data);
  },

  async follow(userId: string): Promise<{ following: boolean; requested: boolean }> {
    const res = await apiClient.post<Envelope<{ following: boolean; requested?: boolean }>>(
      `/follow/${userId}`,
    );
    return {
      following: res.data.data.following,
      requested: res.data.data.requested ?? false,
    };
  },

  async unfollow(userId: string): Promise<{ unfollowed: true }> {
    await apiClient.delete(`/follow/${userId}`);
    return { unfollowed: true } as const;
  },

  async followRequests(cursor?: string): Promise<FollowPage> {
    const res = await apiClient.get<Envelope<RawFollowList>>('/follow/requests', {
      params: cursor ? { cursor } : undefined,
    });
    const { data, nextCursor, hasMore } = res.data.data;
    return { items: data.map(mapSummary), nextCursor, hasMore: hasMore ?? nextCursor !== null };
  },

  async acceptFollowRequest(userId: string): Promise<{ accepted: true }> {
    const res = await apiClient.post<Envelope<{ accepted: true }>>(`/follow/${userId}/accept`);
    return res.data.data;
  },

  async rejectFollowRequest(userId: string): Promise<{ rejected: boolean }> {
    const res = await apiClient.post<Envelope<{ rejected: boolean }>>(`/follow/${userId}/reject`);
    return res.data.data;
  },

  async followers(userId: string, cursor?: string): Promise<FollowPage> {
    // Parameterized endpoint returns the target user's followers (works for
    // self too). Backend: GET /follow/:userId/followers → { data, nextCursor }.
    // The backend caps `limit` at 50 and drives paging off the createdAt
    // cursor, so we thread `cursor` through for infinite scroll.
    const res = await apiClient.get<Envelope<RawFollowList>>(`/follow/${userId}/followers`, {
      params: cursor ? { cursor } : undefined,
    });
    const { data, nextCursor, hasMore } = res.data.data;
    return { items: data.map(mapSummary), nextCursor, hasMore: hasMore ?? nextCursor !== null };
  },

  async following(userId: string, cursor?: string): Promise<FollowPage> {
    const res = await apiClient.get<Envelope<RawFollowList>>(`/follow/${userId}/following`, {
      params: cursor ? { cursor } : undefined,
    });
    const { data, nextCursor, hasMore } = res.data.data;
    return { items: data.map(mapSummary), nextCursor, hasMore: hasMore ?? nextCursor !== null };
  },

  async search(query: string): Promise<User[]> {
    const q = query.trim();
    // Empty query → no results (the backend rejects empty q). Previously this
    // returned a hard-coded MOCK list, which surfaced fabricated users in the
    // invite/search UIs — a real data bug. Callers should gate on a non-empty
    // query; this guard keeps the behaviour safe regardless.
    if (q.length === 0) return [];

    const res = await apiClient.get<Envelope<RawSearchUser[]>>('/users/search', {
      params: { q },
    });
    return res.data.data.map(mapSummary);
  },
};
