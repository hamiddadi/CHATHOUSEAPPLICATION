import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const register = async (app: Express) => {
  const username = `sd_${rand()}`;
  const result = await request(app)
    .post('/api/auth/register')
    .send({
      username,
      email: `${username}@test.local`,
      password: 'test-password-123',
    });
  expect(result.status).toBe(201);
  return {
    id: result.body.data.user.id as string,
    username,
    token: result.body.data.accessToken as string,
  };
};

describe('Soft-deleted account visibility', () => {
  let app: Express;
  const userIds: string[] = [];
  const roomIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const roomId of roomIds) {
      await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    }
    for (const userId of userIds) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('removes a pending-deletion account from every sensitive social surface', async () => {
    const viewer = await register(app);
    const subject = await register(app);
    const third = await register(app);
    userIds.push(viewer.id, subject.id, third.id);

    await prisma.user.update({
      where: { id: subject.id },
      data: { dmPrivacy: 'everyone' },
    });
    await prisma.user.update({
      where: { id: viewer.id },
      data: { isPremium: true },
    });
    await prisma.profileView.create({
      data: { viewerId: subject.id, viewedUserId: viewer.id },
    });

    const follow = await request(app)
      .post(`/api/follow/${subject.id}`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(follow.status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/follow/${third.id}`)
          .set('Authorization', `Bearer ${viewer.token}`)
      ).status,
    ).toBe(200);

    const room = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${subject.token}`)
      .send({ title: `Soft delete room ${subject.username}` });
    expect(room.status).toBe(201);
    roomIds.push(room.body.data.id as string);

    const group = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ title: 'Visibility group', memberIds: [subject.id, third.id] });
    expect(group.status).toBe(201);
    const groupId = group.body.data.id as string;

    const initialMessage = await request(app)
      .post(`/api/chat/${subject.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ content: 'Visible before deletion' });
    expect(initialMessage.status).toBe(201);

    // Simulate a stale relation/read model after the account lifecycle has
    // marked the user deleted. Every surface must independently fail closed.
    await prisma.user.update({
      where: { id: subject.id },
      data: {
        deletedAt: new Date(),
        isOnline: false,
        isVisible: false,
        latitude: null,
        longitude: null,
      },
    });

    const search = await request(app)
      .get(`/api/search?q=${subject.username}&type=users`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(search.status).toBe(200);
    expect(search.body.data.users.map((user: { id: string }) => user.id)).not.toContain(subject.id);

    const following = await request(app)
      .get('/api/follow/following')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(following.status).toBe(200);
    expect(following.body.data.data.map((user: { id: string }) => user.id)).not.toContain(
      subject.id,
    );

    const rooms = await request(app)
      .get('/api/rooms')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(rooms.status).toBe(200);
    expect(rooms.body.data.map((candidate: { id: string }) => candidate.id)).not.toContain(
      room.body.data.id,
    );

    const sendAfterDeletion = await request(app)
      .post(`/api/chat/${subject.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ content: 'Must not be delivered' });
    expect(sendAfterDeletion.status).toBe(404);
    expect(sendAfterDeletion.body.error.code).toBe('USER_001');

    const conversations = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(conversations.status).toBe(200);
    expect(
      conversations.body.data.map((conversation: { peer: { id: string } }) => conversation.peer.id),
    ).not.toContain(subject.id);

    const profileViews = await request(app)
      .get('/api/users/me/profile-views')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(profileViews.status).toBe(200);
    expect(
      profileViews.body.data.map((item: { user: { id: string } }) => item.user.id),
    ).not.toContain(subject.id);

    const groupDetail = await request(app)
      .get(`/api/groups/${groupId}`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(groupDetail.status).toBe(200);
    expect(groupDetail.body.data.members.map((member: { id: string }) => member.id)).not.toContain(
      subject.id,
    );
  });
});
