import type { Room, RoomParticipant, RoomSummary } from '../types/domain';
import { MOCK_USER_SUMMARIES } from './users.mock';

const pickUser = (idx: number): (typeof MOCK_USER_SUMMARIES)[number] => {
  const u = MOCK_USER_SUMMARIES[idx] ?? MOCK_USER_SUMMARIES[0];
  if (!u) throw new Error('MOCK_USER_SUMMARIES is empty — cannot build mock rooms.');
  return u;
};

const speaker = (
  idx: number,
  role: 'host' | 'speaker',
  audio: 'speaking' | 'muted' | 'idle',
): RoomParticipant => ({
  ...pickUser(idx),
  role,
  audio,
  handRaised: false,
});

export const MOCK_ROOMS: readonly Room[] = [
  {
    id: 'r1',
    title: 'Scaling to 10M users: Secrets from the edge',
    description: 'Patterns and pitfalls from teams who shipped audio at scale.',
    category: 'tech',
    categoryEmoji: '💻',
    visibility: 'public',
    houseId: 'h-yc',
    houseName: 'Y Combinator',
    hostId: 'u1',
    speakers: [
      speaker(0, 'host', 'speaking'),
      speaker(1, 'speaker', 'muted'),
      speaker(2, 'speaker', 'muted'),
      speaker(3, 'speaker', 'muted'),
      speaker(4, 'speaker', 'muted'),
    ],
    listeners: MOCK_USER_SUMMARIES.slice(5, 12),
    speakersCount: 12,
    listenersCount: 142,
    isLive: true,
    isRecording: false,
    chatEnabled: true,
    chatVisibility: 'ALL',
    startedAt: '2026-04-18T10:30:00Z',
    scheduledFor: null,
  },
  {
    id: 'r2',
    title: 'The Death of Minimalism? 2024 Trends',
    description: null,
    category: 'design',
    categoryEmoji: '🎨',
    visibility: 'public',
    houseId: 'h-ui-masters',
    houseName: 'UI Masters Club',
    hostId: 'u4',
    speakers: [
      speaker(3, 'host', 'idle'),
      speaker(4, 'speaker', 'speaking'),
      speaker(5, 'speaker', 'muted'),
    ],
    listeners: MOCK_USER_SUMMARIES.slice(0, 8),
    speakersCount: 8,
    listenersCount: 89,
    isLive: true,
    isRecording: false,
    chatEnabled: true,
    chatVisibility: 'ALL',
    startedAt: '2026-04-18T11:00:00Z',
    scheduledFor: null,
  },
  {
    id: 'r3',
    title: 'Governance 2.0: The state of decentralized voting',
    description: null,
    category: 'crypto',
    categoryEmoji: '₿',
    visibility: 'public',
    houseId: 'h-dao',
    houseName: 'DAO Global',
    hostId: 'u6',
    speakers: [
      speaker(6, 'host', 'muted'),
      speaker(7, 'speaker', 'muted'),
      speaker(8, 'speaker', 'speaking'),
    ],
    listeners: MOCK_USER_SUMMARIES.slice(9, 15),
    speakersCount: 15,
    listenersCount: 312,
    isLive: true,
    isRecording: true,
    chatEnabled: true,
    chatVisibility: 'ALL',
    startedAt: '2026-04-18T09:45:00Z',
    scheduledFor: null,
  },
  {
    id: 'r4',
    title: 'Future of Generative UI Interfaces',
    description: 'A deep dive into AI-driven interfaces.',
    category: 'ai',
    categoryEmoji: '🤖',
    visibility: 'public',
    houseId: 'h-product-club',
    houseName: 'The Product Club',
    hostId: 'u1',
    speakers: [
      speaker(0, 'host', 'speaking'),
      speaker(1, 'speaker', 'muted'),
      speaker(2, 'speaker', 'muted'),
      speaker(3, 'speaker', 'muted'),
      speaker(4, 'speaker', 'muted'),
    ],
    listeners: MOCK_USER_SUMMARIES.slice(5, 14),
    speakersCount: 5,
    listenersCount: 248,
    isLive: true,
    isRecording: true,
    chatEnabled: true,
    chatVisibility: 'ALL',
    startedAt: '2026-04-18T12:00:00Z',
    scheduledFor: null,
  },
];

export const MOCK_ROOM_SUMMARIES: readonly RoomSummary[] = MOCK_ROOMS.map(r => ({
  id: r.id,
  title: r.title,
  category: r.category,
  categoryEmoji: r.categoryEmoji,
  houseName: r.houseName,
  speakersCount: r.speakersCount,
  listenersCount: r.listenersCount,
  topSpeakers: r.speakers.slice(0, 3).map(s => ({
    id: s.id,
    username: s.username,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
  })),
  topListeners: r.listeners.slice(0, 5).map(l => ({
    id: l.id,
    username: l.username,
    displayName: l.displayName,
    avatarUrl: l.avatarUrl,
  })),
}));

export const findRoomById = (id: string): Room | undefined => MOCK_ROOMS.find(r => r.id === id);
