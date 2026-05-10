import { CURRENT_USER, MOCK_USERS, findUserById } from '../../../shared/mocks/users.mock';
import { apiClient } from '../../../shared/services/api/apiClient';
import type { User } from '../../../shared/types/domain';

interface Envelope<T> {
  success: true;
  data: T;
}

// Shape returned by GET /api/users/search — narrower than the full User
// domain type. We fill the remaining fields with safe defaults so the
// hook's `User[]` return type stays intact.
interface RawSearchUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isOnline: boolean;
  createdAt: string;
}

const wait = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms));

export interface UpdateProfileInput {
  displayName?: string;
  username?: string;
  bio?: string;
  avatarUrl?: string | null;
}

export const profileService = {
  async me(): Promise<User> {
    await wait(200);
    return CURRENT_USER;
  },

  async get(userId: string): Promise<User> {
    await wait(200);
    const user = findUserById(userId);
    if (!user) throw new Error(`User ${userId} not found`);
    return user;
  },

  async update(input: UpdateProfileInput): Promise<User> {
    await wait(400);
    return {
      ...CURRENT_USER,
      displayName: input.displayName?.trim() ?? CURRENT_USER.displayName,
      username: input.username?.trim() ?? CURRENT_USER.username,
      bio: input.bio?.trim() ?? CURRENT_USER.bio,
      avatarUrl: input.avatarUrl === undefined ? CURRENT_USER.avatarUrl : input.avatarUrl,
    };
  },

  async follow(userId: string): Promise<{ followed: true }> {
    await wait(150);
    if (!findUserById(userId)) throw new Error(`User ${userId} not found`);
    return { followed: true };
  },

  async unfollow(userId: string): Promise<{ unfollowed: true }> {
    await wait(150);
    if (!findUserById(userId)) throw new Error(`User ${userId} not found`);
    return { unfollowed: true };
  },

  async followers(userId: string): Promise<User[]> {
    await wait(250);
    if (!findUserById(userId)) throw new Error(`User ${userId} not found`);
    return MOCK_USERS.slice(0, 8);
  },

  async following(userId: string): Promise<User[]> {
    await wait(250);
    if (!findUserById(userId)) throw new Error(`User ${userId} not found`);
    return MOCK_USERS.slice(8, 14);
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
    return res.data.data.map(
      (u): User => ({
        id: u.id,
        username: u.username ?? '',
        displayName: u.displayName ?? u.username ?? '',
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        isOnline: u.isOnline,
        // These counts aren't part of the search payload (they'd require
        // an N+1 lookup). Callers that need them should fetch the user
        // detail via `get(userId)`.
        followersCount: 0,
        followingCount: 0,
        isFollowedByMe: false,
        createdAt: u.createdAt,
      }),
    );
  },
};
