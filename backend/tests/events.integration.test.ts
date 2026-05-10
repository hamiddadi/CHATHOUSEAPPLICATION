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
const { getRemindersQueue, shutdownReminders } =
  require('../src/queues/eventReminders') as typeof import('../src/queues/eventReminders');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const registerUser = async (app: Express) => {
  const username = `e_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    username,
    token: res.body.data.accessToken as string,
  };
};

describe('Events integration — scheduled rooms, RSVP, BullMQ reminder scheduling', () => {
  let app: Express;
  const createdUserIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdClubIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdRoomIds) {
      await prisma.room.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdClubIds) {
      await prisma.club.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    // Drain the queue so jobs scheduled by tests don't leak across suites.
    const q = getRemindersQueue();
    await q.drain(true);
    await shutdownReminders();
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('scheduled room: created with isLive=false, stored scheduledFor, reminder job enqueued', async () => {
    const host = await registerUser(app);
    createdUserIds.push(host.id);

    const when = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Upcoming AMA', scheduledFor: when });
    expect(create.status).toBe(201);
    expect(create.body.data.isLive).toBe(false);
    expect(create.body.data.scheduledFor).toBe(when);
    const roomId = create.body.data.id as string;
    createdRoomIds.push(roomId);

    // The room should NOT appear in the default (live) listing.
    const live = await request(app).get('/api/rooms').set('Authorization', `Bearer ${host.token}`);
    expect(live.body.data.some((r: { id: string }) => r.id === roomId)).toBe(false);

    // But should appear in ?filter=upcoming
    const upcoming = await request(app)
      .get('/api/rooms?filter=upcoming')
      .set('Authorization', `Bearer ${host.token}`);
    expect(upcoming.body.data.some((r: { id: string }) => r.id === roomId)).toBe(true);

    // Reminder job present in the queue with jobId `room-reminder:<id>`.
    const q = getRemindersQueue();
    const job = await q.getJob(`room-reminder-${roomId}`);
    expect(job).toBeTruthy();
    expect(job?.data.roomId).toBe(roomId);
    // Delay should be roughly 55min from now (+1h minus 5min lead).
    const delay = (job?.opts.delay ?? 0) / 1000;
    expect(delay).toBeGreaterThan(50 * 60 - 30);
    expect(delay).toBeLessThan(60 * 60);
  });

  it('past scheduledFor is rejected with VALIDATION_001', async () => {
    const host = await registerUser(app);
    createdUserIds.push(host.id);
    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Time machine room',
        scheduledFor: new Date(Date.now() - 60 * 1000).toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  it('scheduled room cannot be joined until it goes live (ROOM_004)', async () => {
    const host = await registerUser(app);
    const guest = await registerUser(app);
    createdUserIds.push(host.id, guest.id);

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Future room',
        scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });
    const roomId = create.body.data.id as string;
    createdRoomIds.push(roomId);

    const join = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(join.status).toBe(410);
    expect(join.body.error.code).toBe('ROOM_004');
  });

  it('RSVP flow: guest rsvps → appears in rsvps list → cancels', async () => {
    const host = await registerUser(app);
    const guest = await registerUser(app);
    createdUserIds.push(host.id, guest.id);

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'RSVP room',
        scheduledFor: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      });
    const roomId = create.body.data.id as string;
    createdRoomIds.push(roomId);

    const rsvp = await request(app)
      .post(`/api/rooms/${roomId}/rsvp`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(rsvp.status).toBe(200);
    expect(rsvp.body.data.rsvped).toBe(true);

    // Idempotent — second rsvp does not error.
    const again = await request(app)
      .post(`/api/rooms/${roomId}/rsvp`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(again.status).toBe(200);

    const list = await request(app)
      .get(`/api/rooms/${roomId}/rsvps`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((u: { id: string }) => u.id)).toContain(guest.id);

    // Guest sees it in their "my upcoming events" feed.
    const mine = await request(app)
      .get('/api/rooms/events/mine')
      .set('Authorization', `Bearer ${guest.token}`);
    expect(mine.body.data.some((r: { id: string }) => r.id === roomId)).toBe(true);

    const cancel = await request(app)
      .delete(`/api/rooms/${roomId}/rsvp`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.cancelled).toBe(true);

    const listAfter = await request(app)
      .get(`/api/rooms/${roomId}/rsvps`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(listAfter.body.data.map((u: { id: string }) => u.id)).not.toContain(guest.id);
  });

  it('RSVP on a live (non-scheduled) room is rejected with ROOM_004', async () => {
    const host = await registerUser(app);
    createdUserIds.push(host.id);
    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Live only' });
    const roomId = create.body.data.id as string;
    createdRoomIds.push(roomId);

    const rsvp = await request(app)
      .post(`/api/rooms/${roomId}/rsvp`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(rsvp.status).toBe(410);
    expect(rsvp.body.error.code).toBe('ROOM_004');
  });

  it('ending a scheduled room cancels the reminder job', async () => {
    const host = await registerUser(app);
    createdUserIds.push(host.id);

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        title: 'Will be cancelled',
        scheduledFor: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });
    const roomId = create.body.data.id as string;
    createdRoomIds.push(roomId);

    const q = getRemindersQueue();
    expect(await q.getJob(`room-reminder-${roomId}`)).toBeTruthy();

    const end = await request(app)
      .delete(`/api/rooms/${roomId}`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(end.status).toBe(200);

    // BullMQ returns `undefined` (not `null`) for a missing job id.
    expect(await q.getJob(`room-reminder-${roomId}`)).toBeFalsy();
  });

  it('club-scoped scheduled room: non-member forbidden (CLUB_002), member ok, liveRoomsCount updates', async () => {
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    createdUserIds.push(owner.id, outsider.id);

    const clubRes = await request(app)
      .post('/api/clubs')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Event House', privacy: 'OPEN' });
    const clubId = clubRes.body.data.id as string;
    createdClubIds.push(clubId);

    // Outsider cannot attach a room to a club they don't belong to.
    const forbidden = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ title: 'Sneaky', clubId });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CLUB_002');

    // Owner creates a LIVE room in the club → liveRoomsCount becomes 1.
    const liveRoom = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Club live', clubId });
    createdRoomIds.push(liveRoom.body.data.id);

    const detail = await request(app)
      .get(`/api/clubs/${clubId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(detail.body.data.liveRoomsCount).toBe(1);
  });
});
