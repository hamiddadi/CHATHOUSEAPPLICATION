import type { AppNotification } from '../types/domain';
import { pickUser as basePickUser } from './_helpers';

const actor = (idx: number): ReturnType<typeof basePickUser> =>
  basePickUser(idx, 'MOCK_USER_SUMMARIES is empty — cannot build mock notifications.');

export const MOCK_NOTIFICATIONS: readonly AppNotification[] = [
  {
    id: 'n1',
    kind: 'follow',
    actor: actor(0),
    message: 'started following you',
    roomId: null,
    houseId: null,
    createdAt: '2026-04-18T14:55:00Z',
    isRead: false,
  },
  {
    id: 'n2',
    kind: 'room_invite',
    actor: actor(1),
    message: 'invited you to "Scaling to 10M users"',
    roomId: 'r1',
    houseId: null,
    createdAt: '2026-04-18T14:30:00Z',
    isRead: false,
  },
  {
    id: 'n3',
    kind: 'house_invite',
    actor: actor(2),
    message: 'invited you to join Women in Tech',
    roomId: null,
    houseId: 'h-women-tech',
    createdAt: '2026-04-18T13:10:00Z',
    isRead: true,
  },
  {
    id: 'n4',
    kind: 'room_starting',
    actor: actor(3),
    message: 'is starting a room in 5 minutes',
    roomId: 'r2',
    houseId: 'h-ui-masters',
    createdAt: '2026-04-18T11:55:00Z',
    isRead: true,
  },
  {
    id: 'n5',
    kind: 'mention',
    actor: actor(4),
    message: 'mentioned you in "Governance 2.0"',
    roomId: 'r3',
    houseId: 'h-dao',
    createdAt: '2026-04-18T10:02:00Z',
    isRead: true,
  },
  {
    id: 'n6',
    kind: 'wave',
    actor: actor(5),
    message: 'waved at you 👋',
    roomId: null,
    houseId: null,
    createdAt: '2026-04-17T18:45:00Z',
    isRead: true,
  },
];
