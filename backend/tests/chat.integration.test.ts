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

const registerUser = async (app: Express) => {
  const username = `c_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
  };
};

/**
 * DMs require a mutual follow; each test that sends messages needs to
 * set that up first. Wraps both directions in one helper.
 */
const makeMutualFollows = async (
  app: Express,
  a: { id: string; token: string },
  b: { id: string; token: string },
) => {
  await request(app).post(`/api/follow/${b.id}`).set('Authorization', `Bearer ${a.token}`);
  await request(app).post(`/api/follow/${a.id}`).set('Authorization', `Bearer ${b.token}`);
};

describe('Chat integration', () => {
  let app: Express;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('round-trip: send → list history → mark read → conversation preview', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);
    await makeMutualFollows(app, alice, bob);

    // Alice sends two messages to Bob
    const first = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'Hey!' });
    expect(first.status).toBe(201);
    const firstId = first.body.data.id as string;

    const second = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'Are you around?' });
    expect(second.status).toBe(201);

    // Bob fetches history (oldest-first after reversal in service)
    const history = await request(app)
      .get(`/api/chat/${alice.id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data[0].content).toBe('Hey!');
    expect(history.body.data[1].content).toBe('Are you around?');

    // Bob sees one conversation with Alice + 2 unread
    const convos = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(convos.status).toBe(200);
    expect(convos.body.data).toHaveLength(1);
    expect(convos.body.data[0].peer.id).toBe(alice.id);
    expect(convos.body.data[0].unreadCount).toBe(2);

    // Bob marks the first message read
    const read = await request(app)
      .patch(`/api/chat/messages/${firstId}/read`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(read.status).toBe(200);
    expect(read.body.data.isRead).toBe(true);

    // Alice cannot mark Bob's incoming as read (she is the sender)
    const forbidden = await request(app)
      .patch(`/api/chat/messages/${firstId}/read`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('CHAT_003');

    // Alice can delete her own message
    const del = await request(app)
      .delete(`/api/chat/messages/${firstId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    // Bob's attempt to delete Alice's remaining message returns 403
    const remainingId = second.body.data.id as string;
    const denied = await request(app)
      .delete(`/api/chat/messages/${remainingId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(denied.status).toBe(403);
  });

  it('keeps an old conversation visible beyond 500 newer messages and counts all unread rows', async () => {
    const viewer = await registerUser(app);
    const busyPeer = await registerUser(app);
    const oldPeer = await registerUser(app);
    createdIds.push(viewer.id, busyPeer.id, oldPeer.id);

    const now = Date.now();
    const oldMessage = await prisma.message.create({
      data: {
        content: 'old but still a real conversation',
        senderId: oldPeer.id,
        receiverId: viewer.id,
        createdAt: new Date(now - 60_000),
      },
    });
    await prisma.message.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        id: `bulk_${rand()}_${index}`,
        content: `busy-${index}`,
        senderId: busyPeer.id,
        receiverId: viewer.id,
        createdAt: new Date(now - 10_000 + index),
      })),
    });

    const response = await request(app)
      .get('/api/chat/conversations?limit=2')
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.hasMore).toBe(false);
    expect(response.body.data.nextCursor).toBeNull();
    expect(response.body.data.data).toHaveLength(2);
    expect(response.body.data.data.map((item: { peer: { id: string } }) => item.peer.id)).toEqual([
      busyPeer.id,
      oldPeer.id,
    ]);
    expect(response.body.data.data[0].unreadCount).toBe(501);
    expect(response.body.data.data[1].unreadCount).toBe(1);

    // PostgreSQL timestamps can collide (or differ below JavaScript's
    // millisecond precision). A composite cursor must still return each peer
    // exactly once across page boundaries.
    await prisma.message.update({
      where: { id: oldMessage.id },
      data: { createdAt: new Date(now - 10_000 + 500) },
    });
    const firstPage = await request(app)
      .get('/api/chat/conversations?limit=1')
      .set('Authorization', `Bearer ${viewer.token}`);
    const cursor = firstPage.body.data.nextCursor as string;
    const secondPage = await request(app)
      .get(`/api/chat/conversations?limit=1&cursor=${encodeURIComponent(cursor)}`)
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(firstPage.body.data.hasMore).toBe(true);
    expect(cursor).toMatch(/^v1\./);
    expect(secondPage.body.data.hasMore).toBe(false);
    expect(
      new Set([
        firstPage.body.data.data[0].peer.id as string,
        secondPage.body.data.data[0].peer.id as string,
      ]),
    ).toEqual(new Set([busyPeer.id, oldPeer.id]));

    await prisma.user.update({
      where: { id: oldPeer.id },
      data: { deletedAt: new Date() },
    });
    const withoutDeletedPeer = await request(app)
      .get('/api/chat/conversations?limit=2')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(
      withoutDeletedPeer.body.data.data.map((item: { peer: { id: string } }) => item.peer.id),
    ).toEqual([busyPeer.id]);
  });

  it('paginates 501 distinct conversations without truncating the final peer', async () => {
    const viewer = await registerUser(app);
    createdIds.push(viewer.id);
    const tag = `many_${rand()}`;
    const peerRows = Array.from({ length: 501 }, (_, index) => ({
      id: `${tag}_peer_${String(index).padStart(3, '0')}`,
      username: `${tag}_${index}`,
      displayName: `Peer ${index}`,
    }));

    try {
      await prisma.user.createMany({ data: peerRows });
      const base = Date.now() - 1_000_000;
      await prisma.message.createMany({
        data: peerRows.map((peer, index) => ({
          id: `${tag}_message_${String(index).padStart(3, '0')}`,
          content: `conversation ${index}`,
          senderId: peer.id,
          receiverId: viewer.id,
          createdAt: new Date(base + index),
        })),
      });

      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await request(app)
          .get('/api/chat/conversations')
          .query({ limit: 100, ...(cursor ? { cursor } : {}) })
          .set('Authorization', `Bearer ${viewer.token}`);
        expect(page.status).toBe(200);
        for (const item of page.body.data.data as Array<{ peer: { id: string } }>) {
          expect(seen.has(item.peer.id)).toBe(false);
          seen.add(item.peer.id);
        }
        cursor = (page.body.data.nextCursor as string | null) ?? undefined;
      } while (cursor);

      expect(seen.size).toBe(501);
      expect(peerRows.every(peer => seen.has(peer.id))).toBe(true);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: peerRows.map(peer => peer.id) } } });
    }
  });

  it('uses a composite cursor so equal-timestamp DM rows survive a page boundary', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);
    const timestamp = new Date('2026-08-10T12:00:00.123Z');
    const prefix = `tie_${rand()}`;
    const ids = ['a', 'b', 'c', 'd'].map(suffix => `${prefix}_${suffix}`);
    await prisma.message.createMany({
      data: ids.map((id, index) => ({
        id,
        content: `tied ${index}`,
        senderId: alice.id,
        receiverId: bob.id,
        createdAt: timestamp,
      })),
    });

    const first = await request(app)
      .get(`/api/chat/${alice.id}`)
      .query({ limit: 2, paginated: 'true' })
      .set('Authorization', `Bearer ${bob.token}`);
    const second = await request(app)
      .get(`/api/chat/${alice.id}`)
      .query({ limit: 2, paginated: 'true', before: first.body.data.nextCursor })
      .set('Authorization', `Bearer ${bob.token}`);

    expect(first.status).toBe(200);
    expect(first.body.data.nextCursor).toMatch(/^v1\./);
    expect(second.status).toBe(200);
    const seen = [...first.body.data.data, ...second.body.data.data].map(
      (message: { id: string }) => message.id,
    );
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen).toHaveLength(ids.length);
    expect(second.body.data.nextCursor).toBeNull();
  });

  it('rejects an invalid DM history cursor as a 400 validation error', async () => {
    const viewer = await registerUser(app);
    createdIds.push(viewer.id);

    const response = await request(app)
      .get('/api/chat/any-peer')
      .query({ before: 'not-a-valid-cursor', paginated: 'true' })
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_001');
  });

  it('mutual-follow guard: blocks DM unless both sides follow each other (CHAT_004)', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);

    // No follows at all → CHAT_004
    const strangers = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'Hello?' });
    expect(strangers.status).toBe(403);
    expect(strangers.body.error.code).toBe('CHAT_004');

    // Alice follows Bob — still one-way, still blocked.
    await request(app).post(`/api/follow/${bob.id}`).set('Authorization', `Bearer ${alice.token}`);
    const oneWay = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'Still?' });
    expect(oneWay.status).toBe(403);
    expect(oneWay.body.error.code).toBe('CHAT_004');

    // Bob follows Alice back — now mutual, DM allowed.
    await request(app).post(`/api/follow/${alice.id}`).set('Authorization', `Bearer ${bob.token}`);
    const ok = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'Finally.' });
    expect(ok.status).toBe(201);
  });

  it('block overrides dmPrivacy=everyone: a blocked user cannot DM (CHAT_004)', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);

    // Bob opens his DMs to everyone — without a block, anyone may message him
    // (no mutual follow needed).
    await prisma.user.update({ where: { id: bob.id }, data: { dmPrivacy: 'everyone' } });

    // Sanity: everyone + no block ⇒ a stranger CAN DM.
    const open = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'hi (open)' });
    expect(open.status).toBe(201);

    // Bob blocks Alice.
    await prisma.block.create({ data: { blockerId: bob.id, blockedId: alice.id } });

    // Alice (blocked) can no longer DM Bob despite dmPrivacy=everyone.
    const blocked = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'hi (blocked)' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CHAT_004');

    // The cut is symmetric: Bob (the blocker) also cannot DM Alice.
    await prisma.user.update({ where: { id: alice.id }, data: { dmPrivacy: 'everyone' } });
    const reverse = await request(app)
      .post(`/api/chat/${alice.id}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ content: 'hi back' });
    expect(reverse.status).toBe(403);
    expect(reverse.body.error.code).toBe('CHAT_004');

    // Lifting the block restores messaging under dmPrivacy=everyone.
    await prisma.block.deleteMany({ where: { blockerId: bob.id, blockedId: alice.id } });
    const restored = await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'hi again' });
    expect(restored.status).toBe(201);
  });

  it('unread-count + markReadWithPeer: bulk-read drops the count to zero', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);
    await makeMutualFollows(app, alice, bob);

    await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'one' });
    await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'two' });
    await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'three' });

    const before = await request(app)
      .get('/api/chat/unread-count')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(before.status).toBe(200);
    expect(before.body.data.count).toBe(3);

    const bulk = await request(app)
      .patch(`/api/chat/${alice.id}/read`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.updated).toBe(3);

    const after = await request(app)
      .get('/api/chat/unread-count')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(after.body.data.count).toBe(0);

    // Messages alice sent are still visible to her as sender, just now isRead=true for bob.
    const history = await request(app)
      .get(`/api/chat/${alice.id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(history.body.data.every((m: { isRead: boolean }) => m.isRead)).toBe(true);
  });

  it('incoming DM creates a notification for the recipient', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    createdIds.push(alice.id, bob.id);
    await makeMutualFollows(app, alice, bob);

    const before = await prisma.notification.count({
      where: { userId: bob.id, type: 'NEW_MESSAGE' },
    });

    await request(app)
      .post(`/api/chat/${bob.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'yo' });

    // notificationsService.create is fired via `void`; give it a tick to
    // flush the insert before we count.
    await new Promise(r => setTimeout(r, 50));

    const after = await prisma.notification.count({
      where: { userId: bob.id, type: 'NEW_MESSAGE' },
    });
    expect(after).toBe(before + 1);
  });

  it('self-DM is rejected (CHAT_001)', async () => {
    const u = await registerUser(app);
    createdIds.push(u.id);

    const res = await request(app)
      .post(`/api/chat/${u.id}`)
      .set('Authorization', `Bearer ${u.token}`)
      .send({ content: 'talking to myself' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHAT_001');
  });
});
