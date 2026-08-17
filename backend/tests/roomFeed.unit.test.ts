jest.mock('../src/config/database', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    follow: { findMany: jest.fn() },
    room: { findMany: jest.fn() },
  },
}));
jest.mock('../src/modules/social/blocks', () => ({
  getBlockedIdSet: jest.fn(),
}));
jest.mock('../src/modules/rooms/rooms.access', () => ({
  discoverableRoomWhere: jest.fn().mockReturnValue({ isPrivate: false }),
}));

import { prisma } from '../src/config/database';
import { getBlockedIdSet } from '../src/modules/social/blocks';
import {
  getPersonalizedRoomFeed,
  MAX_FEED_CANDIDATE_POOL,
} from '../src/modules/rooms/room-feed.service';

describe('personalized room feed query shape', () => {
  it('ranks a lightweight bounded candidate window then hydrates only the page', async () => {
    const candidates = [
      {
        id: 'room-friend',
        hostId: 'host-friend',
        title: 'Music room',
        topic: null,
        topics: ['music'],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        participantCount: 8,
        participants: [{ userId: 'host-friend' }],
      },
      {
        id: 'room-other',
        hostId: 'host-other',
        title: 'Other room',
        topic: null,
        topics: [],
        createdAt: new Date('2026-01-02T00:00:00Z'),
        participantCount: 1,
        participants: [],
      },
    ];
    const hydrated = candidates.map(room => ({
      id: room.id,
      hostId: room.hostId,
      title: room.title,
      topic: room.topic,
      topics: room.topics,
      createdAt: room.createdAt,
      participantCount: room.participantCount,
      host: { id: room.hostId, username: room.hostId, displayName: null, avatarUrl: null },
      participants: room.participants.map(participant => ({
        ...participant,
        role: 'HOST',
        isMuted: false,
        user: {
          id: participant.userId,
          username: participant.userId,
          displayName: null,
          avatarUrl: null,
        },
      })),
      club: null,
      _count: { rsvps: 0 },
    }));

    jest.mocked(prisma.user.findUnique).mockResolvedValue({ interests: ['music'] } as never);
    jest
      .mocked(prisma.follow.findMany)
      .mockResolvedValue([{ followingId: 'host-friend' }] as never);
    jest.mocked(getBlockedIdSet).mockResolvedValue(new Set());
    jest
      .mocked(prisma.room.findMany)
      .mockResolvedValueOnce(candidates as never)
      .mockResolvedValueOnce(hydrated as never);

    const page = await getPersonalizedRoomFeed('viewer-a', 1, 0);

    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({ id: 'room-friend', hasKnownSpeakers: true });
    const candidateQuery = jest.mocked(prisma.room.findMany).mock.calls[0]?.[0];
    expect(candidateQuery?.take).toBe(200);
    expect(candidateQuery).toHaveProperty('select.participants.select', { userId: true });
    expect(candidateQuery).not.toHaveProperty('include');
    const hydrateQuery = jest.mocked(prisma.room.findMany).mock.calls[1]?.[0];
    expect(hydrateQuery).toHaveProperty('where.id.in', ['room-friend']);
  });

  it('never expands the candidate window beyond its hard cap', async () => {
    jest.mocked(prisma.user.findUnique).mockResolvedValue({ interests: [] } as never);
    jest.mocked(prisma.follow.findMany).mockResolvedValue([]);
    jest.mocked(getBlockedIdSet).mockResolvedValue(new Set());
    jest.mocked(prisma.room.findMany).mockResolvedValue([]);

    await getPersonalizedRoomFeed('viewer-a', 100, 100_000);

    expect(jest.mocked(prisma.room.findMany).mock.calls[0]?.[0]?.take).toBe(
      MAX_FEED_CANDIDATE_POOL,
    );
  });
});
