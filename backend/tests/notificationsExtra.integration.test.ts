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
  const u = `nex_${rand()}`;
  const r = await request(app)
    .post('/api/auth/register')
    .send({ username: u, email: `${u}@test.local`, password: 'test-password-123' });
  return { id: r.body.data.user.id as string, token: r.body.data.accessToken as string };
};

describe('Notifications — new types + filter tabs', () => {
  let app: Express;
  const createdUsers: string[] = [];
  const createdRooms: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdRooms) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUsers) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('host promoting a listener to SPEAKER fires HAND_ACCEPTED on them', async () => {
    const host = await register(app);
    const listener = await register(app);
    createdUsers.push(host.id, listener.id);

    const created = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Stage test' });
    const roomId = created.body.data.id as string;
    createdRooms.push(roomId);

    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${listener.token}`);

    await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ userId: listener.id, role: 'SPEAKER' });

    await new Promise(r => setTimeout(r, 50));
    const notif = await prisma.notification.findFirst({
      where: { userId: listener.id, type: 'HAND_ACCEPTED' },
    });
    expect(notif).toBeTruthy();
    expect((notif?.data as { roomId?: string } | null)?.roomId).toBe(roomId);
  });

  it('DM send now fires NEW_MESSAGE (not MENTION)', async () => {
    const a = await register(app);
    const b = await register(app);
    createdUsers.push(a.id, b.id);

    // Mutual follow to unblock DMs.
    await request(app).post(`/api/follow/${b.id}`).set('Authorization', `Bearer ${a.token}`);
    await request(app).post(`/api/follow/${a.id}`).set('Authorization', `Bearer ${b.token}`);

    await request(app)
      .post(`/api/chat/${b.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ content: 'hi' });

    await new Promise(r => setTimeout(r, 50));
    const nm = await prisma.notification.findFirst({
      where: { userId: b.id, type: 'NEW_MESSAGE' },
    });
    expect(nm).toBeTruthy();
  });

  it('filter tabs: GET /notifications?filter=X narrows the result set', async () => {
    const u = await register(app);
    createdUsers.push(u.id);

    // Seed one notification of each flavour directly.
    const seed = async (type: import('@prisma/client').NotificationType) => {
      await prisma.notification.create({
        data: { userId: u.id, type, title: 't', body: 'b' },
      });
    };
    await seed('NEW_FOLLOWER');
    await seed('CLUB_INVITE');
    await seed('ROOM_STARTED');
    await seed('HAND_ACCEPTED');
    await seed('NEW_MESSAGE');
    await seed('WAVE');

    const all = await request(app)
      .get('/api/notifications?filter=all')
      .set('Authorization', `Bearer ${u.token}`);
    expect(all.body.data.length).toBeGreaterThanOrEqual(6);

    const rooms = await request(app)
      .get('/api/notifications?filter=rooms')
      .set('Authorization', `Bearer ${u.token}`);
    const roomTypes = rooms.body.data.map((n: { type: string }) => n.type);
    expect(
      roomTypes.every((t: string) =>
        [
          'ROOM_INVITE',
          'ROOM_STARTED',
          'HAND_ACCEPTED',
          'RSVP_REMINDER',
          'SPEAKER_REQUEST',
        ].includes(t),
      ),
    ).toBe(true);
    expect(roomTypes).toEqual(expect.arrayContaining(['ROOM_STARTED', 'HAND_ACCEPTED']));

    const social = await request(app)
      .get('/api/notifications?filter=social')
      .set('Authorization', `Bearer ${u.token}`);
    const socialTypes = social.body.data.map((n: { type: string }) => n.type);
    expect(socialTypes).toEqual(expect.arrayContaining(['NEW_FOLLOWER', 'WAVE', 'NEW_MESSAGE']));
    expect(socialTypes).not.toContain('CLUB_INVITE');

    const clubs = await request(app)
      .get('/api/notifications?filter=clubs')
      .set('Authorization', `Bearer ${u.token}`);
    const clubTypes = clubs.body.data.map((n: { type: string }) => n.type);
    expect(clubTypes.every((t: string) => t === 'CLUB_INVITE')).toBe(true);
  });

  it('invalid filter value falls back to all (no 400)', async () => {
    const u = await register(app);
    createdUsers.push(u.id);
    const res = await request(app)
      .get('/api/notifications?filter=bogus')
      .set('Authorization', `Bearer ${u.token}`);
    expect(res.status).toBe(200);
  });
});
