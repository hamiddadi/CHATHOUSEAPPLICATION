import { MOCK_USERS } from '../../../shared/mocks/users.mock';
import { apiClient } from '../../../shared/services/api/apiClient';
import type { Envelope } from '../../../shared/types/api';
import type { User } from '../../../shared/types/domain';

// Shape returned by GET /api/users/me, PATCH /api/users/me and
// GET /api/users/:id. The two backend selects (`meSelect`/`publicSelect`)
// overlap on every field we read here; the extra `me`-only fields are
// ignored. We narrow to optional/nullable so the same mapper covers both.
interface RawUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isOnline?: boolean;
  followerCount?: number;
  followingCount?: number;
  isFollowedByMe?: boolean;
  createdAt?: string;
}

// Shape returned by GET /api/users/search and the follow list endpoints
// (publicUser select) — narrower than the full User domain type. We fill
// the remaining fields with safe defaults so the hook's `User[]` return
// type stays intact.
interface RawSearchUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isOnline?: boolean;
  createdAt?: string;
}

// Follow list endpoints return a paginated envelope: { data, nextCursor,
// hasMore }. We only consume the first page here (the hooks expose a flat
// `User[]`), so cursor/hasMore are read but not surfaced.
interface RawFollowList {
  data: RawSearchUser[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Fields shared by `mapUser` and `mapSummary`: the username/displayName/
// createdAt normalization is identical for both payload shapes.
const mapBaseUser = (
  u: RawUser | RawSearchUser,
): Pick<
  User,
  'id' | 'username' | 'displayName' | 'avatarUrl' | 'bio' | 'isOnline' | 'createdAt'
> => ({
  id: u.id,
  username: u.username ?? '',
  displayName: u.displayName ?? u.username ?? '',
  avatarUrl: u.avatarUrl,
  bio: u.bio,
  isOnline: u.isOnline ?? false,
  createdAt: u.createdAt ?? new Date().toISOString(),
});

const mapUser = (u: RawUser): User => ({
  ...mapBaseUser(u),
  // Backend denormalizes follower/following counts as `followerCount`
  // (singular); the domain type uses `followersCount`.
  followersCount: u.followerCount ?? 0,
  followingCount: u.followingCount ?? 0,
  // GET /users/:id now returns `isFollowedByMe` per-viewer (derived from the
  // Follow table). GET /users/me omits it (you don't follow yourself) → the
  // ?? false default applies there, which is correct.
  isFollowedByMe: u.isFollowedByMe ?? false,
});

const mapSummary = (u: RawSearchUser): User => ({
  ...mapBaseUser(u),
  // These counts aren't part of the list payload (they'd require an N+1
  // lookup). Callers that need them should fetch the user detail via
  // `get(userId)`.
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
});

export interface UpdateProfileInput {
  displayName?: string;
  username?: string;
  bio?: string;
  avatarUrl?: string | null;
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

  async update(input: UpdateProfileInput): Promise<User> {
    // PATCH /users/me is `.strict()` and only accepts displayName/bio/
    // avatarUrl — `username` lives on a dedicated endpoint. Omit undefined
    // keys so we never send a key the schema would reject, and skip
    // avatarUrl when it isn't a remote URL (the schema requires a valid
    // URL; local ImagePicker `file://` URIs must be uploaded first).
    const body: { displayName?: string; bio?: string; avatarUrl?: string } = {};
    if (input.displayName !== undefined) body.displayName = input.displayName.trim();
    if (input.bio !== undefined) body.bio = input.bio.trim();
    if (typeof input.avatarUrl === 'string' && /^https?:\/\//i.test(input.avatarUrl)) {
      body.avatarUrl = input.avatarUrl;
    }
    const res = await apiClient.patch<Envelope<RawUser>>('/users/me', body);

    // Username changes go through the dedicated endpoint (separate
    // uniqueness check). Only call it when the value actually changed to
    // avoid a redundant USER_002 conflict against the user's own handle.
    const nextUsername = input.username?.trim();
    if (nextUsername && nextUsername !== res.data.data.username) {
      const userRes = await apiClient.patch<Envelope<RawUser>>('/users/me/username', {
        username: nextUsername,
      });
      return mapUser(userRes.data.data);
    }
    return mapUser(res.data.data);
  },

  async follow(userId: string): Promise<{ followed: true }> {
    await apiClient.post(`/follow/${userId}`);
    return { followed: true } as const;
  },

  async unfollow(userId: string): Promise<{ unfollowed: true }> {
    await apiClient.delete(`/follow/${userId}`);
    return { unfollowed: true } as const;
  },

  async followers(userId: string): Promise<User[]> {
    // Parameterized endpoint returns the target user's followers (works for
    // self too). Backend: GET /follow/:userId/followers → { data, nextCursor }.
    const res = await apiClient.get<Envelope<RawFollowList>>(`/follow/${userId}/followers`);
    const { data } = res.data.data;
    return data.map(mapSummary);
  },

  async following(userId: string): Promise<User[]> {
    const res = await apiClient.get<Envelope<RawFollowList>>(`/follow/${userId}/following`);
    const { data } = res.data.data;
    return data.map(mapSummary);
  },

  async search(query: string): Promise<User[]> {
    const q = query.trim();
    // Backend rejects empty q; mimic the old "no query → list" behaviour
    // from the frontend by short-circuiting to the mock list — this path
    // only fires when the search box is empty.
    if (q.length === 0) return [...MOCK_USERS];

    const res = await apiClient.get<Envelope<RawSearchUser[]>>('/users/search', {
      params: { q },
    });
    return res.data.data.map(mapSummary);
  },
};
