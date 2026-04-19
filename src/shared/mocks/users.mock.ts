import { resolveUserAvatar } from '../constants/images';
import type { User, UserSummary } from '../types/domain';

const ref = (id: string, username: string, displayName: string): UserSummary => ({
  id,
  username,
  displayName,
  avatarUrl: resolveUserAvatar(id),
});

export const CURRENT_USER: User = {
  id: 'user-me',
  username: 'claude',
  displayName: 'Claude Delacroix',
  bio: 'Product engineer. Audio rooms obsessive. Coffee snob. Based in Dakar.',
  avatarUrl: resolveUserAvatar('user-me'),
  followersCount: 1240,
  followingCount: 482,
  isFollowedByMe: false,
  isOnline: true,
  createdAt: '2024-06-01T12:00:00Z',
};

export const MOCK_USER_SUMMARIES: readonly UserSummary[] = [
  ref('u1', 'alex', 'Alex Rivers'),
  ref('u2', 'sarahc', 'Sarah Chen'),
  ref('u3', 'mjohnson', 'Marcus Johnson'),
  ref('u4', 'jordanlee', 'Jordan Lee'),
  ref('u5', 'caseyk', 'Casey Kim'),
  ref('u6', 'ryanp', 'Ryan Park'),
  ref('u7', 'miar', 'Mia Rodriguez'),
  ref('u8', 'omarh', 'Omar Hassan'),
  ref('u9', 'liam', 'Liam Fox'),
  ref('u10', 'nova', 'Nova Wright'),
  ref('u11', 'kai', 'Kai Tanaka'),
  ref('u12', 'zara', 'Zara Okonkwo'),
  ref('u13', 'ines', 'Ines Martel'),
  ref('u14', 'paulg', 'Paul Graham'),
  ref('u15', 'jessica', 'Jessica Livingston'),
  ref('u16', 'sama', 'Sam Altman'),
];

export const MOCK_USERS: readonly User[] = MOCK_USER_SUMMARIES.map((s, i) => ({
  id: s.id,
  username: s.username,
  displayName: s.displayName,
  avatarUrl: s.avatarUrl,
  bio: null,
  followersCount: 100 + i * 47,
  followingCount: 50 + i * 13,
  isFollowedByMe: i % 3 === 0,
  isOnline: i % 4 !== 0,
  createdAt: '2024-01-15T10:00:00Z',
}));

export const findUserById = (id: string): User | undefined => MOCK_USERS.find(u => u.id === id);

export const findUserSummaryById = (id: string): UserSummary | undefined =>
  MOCK_USER_SUMMARIES.find(u => u.id === id);
