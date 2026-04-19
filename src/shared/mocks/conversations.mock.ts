import type { Conversation, Message } from '../types/domain';
import { CURRENT_USER, MOCK_USER_SUMMARIES } from './users.mock';

const msg = (
  id: string,
  conversationId: string,
  authorId: string,
  text: string,
  sentAt: string,
): Message => ({
  id,
  conversationId,
  authorId,
  text,
  sentAt,
  isMine: authorId === CURRENT_USER.id,
});

export const MOCK_MESSAGES_BY_CONVO: Readonly<Record<string, readonly Message[]>> = {
  'conv-1': [
    msg(
      'm1-1',
      'conv-1',
      'u1',
      'Hey! Are you coming to the YC room tonight?',
      '2026-04-18T14:02:00Z',
    ),
    msg(
      'm1-2',
      'conv-1',
      CURRENT_USER.id,
      "Yeah, I wouldn't miss it for anything",
      '2026-04-18T14:03:00Z',
    ),
    msg(
      'm1-3',
      'conv-1',
      'u1',
      'Paul Graham will be speaking. Should be wild',
      '2026-04-18T14:03:30Z',
    ),
    msg('m1-4', 'conv-1', CURRENT_USER.id, '🔥', '2026-04-18T14:04:00Z'),
    msg('m1-5', 'conv-1', 'u1', "I'll send you the link when it goes live", '2026-04-18T14:05:00Z'),
    msg('m1-6', 'conv-1', 'u1', 'See you in the room at 4pm 👋', '2026-04-18T14:58:00Z'),
  ],
  'conv-2': [
    msg('m2-1', 'conv-2', 'u2', 'That talk was so good!', '2026-04-18T14:44:00Z'),
    msg(
      'm2-2',
      'conv-2',
      CURRENT_USER.id,
      'Right? The generative UI part blew my mind.',
      '2026-04-18T14:46:00Z',
    ),
    msg('m2-3', 'conv-2', 'u2', 'Did you catch the demo at 12min?', '2026-04-18T14:48:00Z'),
  ],
  'conv-3': [msg('m3-1', 'conv-3', 'u3', 'You joined Indie Hackers', '2026-04-18T14:00:00Z')],
  'conv-4': [msg('m4-1', 'conv-4', 'u4', 'Sent an invite to your house', '2026-04-18T12:00:00Z')],
  'conv-5': [
    msg('m5-1', 'conv-5', 'u5', 'Let me know when you want to chat', '2026-04-17T15:00:00Z'),
  ],
};

const lastOf = (convoId: string): Message | null => {
  const list = MOCK_MESSAGES_BY_CONVO[convoId];
  return list?.at(-1) ?? null;
};

const pickUser = (idx: number): (typeof MOCK_USER_SUMMARIES)[number] => {
  const u = MOCK_USER_SUMMARIES[idx] ?? MOCK_USER_SUMMARIES[0];
  if (!u) throw new Error('MOCK_USER_SUMMARIES is empty — cannot build mock conversations.');
  return u;
};

export const MOCK_CONVERSATIONS: readonly Conversation[] = [
  {
    id: 'conv-1',
    participants: [CURRENT_USER, pickUser(0)],
    lastMessage: lastOf('conv-1'),
    unreadCount: 2,
    updatedAt: '2026-04-18T14:58:00Z',
  },
  {
    id: 'conv-2',
    participants: [CURRENT_USER, pickUser(1)],
    lastMessage: lastOf('conv-2'),
    unreadCount: 0,
    updatedAt: '2026-04-18T14:48:00Z',
  },
  {
    id: 'conv-3',
    participants: [CURRENT_USER, pickUser(2)],
    lastMessage: lastOf('conv-3'),
    unreadCount: 1,
    updatedAt: '2026-04-18T14:00:00Z',
  },
  {
    id: 'conv-4',
    participants: [CURRENT_USER, pickUser(3)],
    lastMessage: lastOf('conv-4'),
    unreadCount: 0,
    updatedAt: '2026-04-18T12:00:00Z',
  },
  {
    id: 'conv-5',
    participants: [CURRENT_USER, pickUser(4)],
    lastMessage: lastOf('conv-5'),
    unreadCount: 0,
    updatedAt: '2026-04-17T15:00:00Z',
  },
];

export const findConversationById = (id: string): Conversation | undefined =>
  MOCK_CONVERSATIONS.find(c => c.id === id);

export const findMessagesByConversationId = (id: string): readonly Message[] =>
  MOCK_MESSAGES_BY_CONVO[id] ?? [];
