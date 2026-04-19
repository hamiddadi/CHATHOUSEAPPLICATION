import { CURRENT_USER, MOCK_USERS, findUserById } from '../../../shared/mocks/users.mock';
import type { User } from '../../../shared/types/domain';

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
    await wait(200);
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [...MOCK_USERS];
    return MOCK_USERS.filter(
      u => u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    );
  },
};
