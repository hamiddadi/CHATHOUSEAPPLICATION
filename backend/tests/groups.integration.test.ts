import request from 'supertest';
import type { Express } from 'express';
import { encodeGroupCursor } from '../src/modules/groups/groups.cursor';

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
  const u = `g_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      username: u,
      email: `${u}@test.local`,
      password: 'test-password-123',
    });
  return {
    id: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
  };
};

const block = (app: Express, token: string, targetId: string) =>
  request(app).post(`/api/users/${targetId}/block`).set('Authorization', `Bearer ${token}`);

const follow = (app: Express, token: string, targetId: string) =>
  request(app).post(`/api/follow/${targetId}`).set('Authorization', `Bearer ${token}`);

const createGroupRaw = (app: Express, token: string, memberIds: string[], title?: string) =>
  request(app)
    .post('/api/groups')
    .set('Authorization', `Bearer ${token}`)
    .send({ memberIds, ...(title !== undefined ? { title } : {}) });

const createGroup = async (app: Express, token: string, memberIds: string[], title?: string) => {
  await Promise.all(memberIds.map(targetId => follow(app, token, targetId)));
  return createGroupRaw(app, token, memberIds, title);
};

describe('Groups — block gate, ownership transfer, rename-to-null', () => {
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

  // ── Fix 1: block gate on create ──────────────────────────────────────────
  it('create: a blocked user cannot open a group with their blocker (GROUP_006)', async () => {
    const alice = await register(app);
    const bob = await register(app); // bob blocks alice
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);

    // bob blocks alice
    await block(app, bob.token, alice.id);

    // alice tries to open a group with bob (+ carol so the ≥2-others rule passes)
    const res = await createGroup(app, alice.token, [bob.id, carol.id]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GROUP_006');
  });

  it('create: the blocker cannot open a group with the user they blocked either (symmetric)', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);

    await block(app, alice.token, bob.id); // alice blocks bob

    const res = await createGroup(app, alice.token, [bob.id, carol.id]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GROUP_006');
  });

  it('create: a third party cannot open a group holding two members who blocked each other (GROUP_006)', async () => {
    const alice = await register(app); // A — blocks bob
    const bob = await register(app); // B
    const carol = await register(app); // C — the third-party creator
    createdIds.push(alice.id, bob.id, carol.id);

    // A blocks B. Neither is the creator, so the old pivot-only check missed
    // this pair entirely and let carol assemble a group with both.
    await block(app, alice.token, bob.id);

    const res = await createGroup(app, carol.token, [alice.id, bob.id]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GROUP_006');

    // No group was persisted for the creator.
    const groups = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${carol.token}`);
    expect(groups.body.data).toHaveLength(0);
  });

  it('create: accepted follows can open a group (201)', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);

    const res = await createGroup(app, alice.token, [bob.id, carol.id], 'Trip planning');
    expect(res.status).toBe(201);
    expect(res.body.data.members).toHaveLength(3);
    expect(res.body.data.title).toBe('Trip planning');
  });

  it('lists every equal-timestamp group through a cursor, even if the boundary is deleted', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);
    const prefix = `group_page_${rand()}`;
    const groupIds = ['a', 'b', 'c', 'd', 'e'].map(suffix => `${prefix}_${suffix}`);
    const timestamp = new Date('2026-08-13T12:00:00.456Z');

    await prisma.$transaction(async tx => {
      await tx.conversation.createMany({
        data: groupIds.map(id => ({
          id,
          ownerId: alice.id,
          title: id,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      });
      await tx.conversationMember.createMany({
        data: groupIds.flatMap(conversationId =>
          [alice.id, bob.id, carol.id].map(userId => ({ conversationId, userId })),
        ),
      });
    });

    const legacy = await request(app)
      .get('/api/groups')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${alice.token}`);
    expect(legacy.status).toBe(200);
    expect(Array.isArray(legacy.body.data)).toBe(true);
    expect(legacy.body.data).toHaveLength(2);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const page = await request(app)
        .get('/api/groups')
        .query({ limit: 2, paginated: 'true', ...(cursor ? { cursor } : {}) })
        .set('Authorization', `Bearer ${alice.token}`);

      expect(page.status).toBe(200);
      expect(Array.isArray(page.body.data.data)).toBe(true);
      seen.push(...page.body.data.data.map((group: { id: string }) => group.id));
      cursor = page.body.data.nextCursor ?? undefined;
      pageCount += 1;

      if (pageCount === 1) {
        expect(cursor).toMatch(/^v1\./);
        const boundaryId = seen[seen.length - 1];
        if (!boundaryId) throw new Error('Expected a first-page boundary group');
        await prisma.conversation.delete({ where: { id: boundaryId } });
      }
      expect(pageCount).toBeLessThan(10);
    } while (cursor);

    expect(new Set(seen)).toEqual(new Set(groupIds));
    expect(seen).toHaveLength(groupIds.length);
  });

  it('rejects invalid group-list pagination queries', async () => {
    const alice = await register(app);
    createdIds.push(alice.id);

    for (const query of [
      { paginated: 'true', cursor: 'not-a-cursor' },
      { cursor: encodeGroupCursor(new Date('2026-08-13T12:00:00.000Z'), 'group-boundary') },
      { paginated: 'true', limit: 0 },
      { paginated: 'true', limit: 101 },
    ]) {
      const response = await request(app)
        .get('/api/groups')
        .query(query)
        .set('Authorization', `Bearer ${alice.token}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_001');
    }
  });

  it('create: a PENDING private-account request is not enough (GROUP_007)', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);
    await prisma.user.update({
      where: { id: bob.id },
      data: { isPrivateAccount: true },
    });

    const pending = await follow(app, alice.token, bob.id);
    expect(pending.body.data.requested).toBe(true);
    expect((await follow(app, alice.token, carol.id)).status).toBe(200);

    const res = await createGroupRaw(app, alice.token, [bob.id, carol.id]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GROUP_007');
  });

  // ── Fix 1: block gate on send ────────────────────────────────────────────
  it('send: a member who gets blocked afterwards can no longer message the group (GROUP_006)', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);

    const group = await createGroup(app, alice.token, [bob.id, carol.id]);
    expect(group.status).toBe(201);
    const gid = group.body.data.id as string;

    // A first message flows fine (no block yet).
    const ok = await request(app)
      .post(`/api/groups/${gid}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'hi all' });
    expect(ok.status).toBe(201);

    // bob now blocks alice; alice must no longer be able to message the shared group.
    await block(app, bob.token, alice.id);
    const denied = await request(app)
      .post(`/api/groups/${gid}/messages`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ content: 'still here?' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('GROUP_006');

    // carol (unrelated to the block) can still send.
    const carolOk = await request(app)
      .post(`/api/groups/${gid}/messages`)
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ content: 'i can still talk' });
    expect(carolOk.status).toBe(201);
  });

  // ── Fix 1: block gate on addMembers ──────────────────────────────────────
  it('addMembers: cannot add a user who is blocked with an existing member (GROUP_006)', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    const dave = await register(app);
    createdIds.push(alice.id, bob.id, carol.id, dave.id);

    // alice owns a group with bob + carol.
    const group = await createGroup(app, alice.token, [bob.id, carol.id]);
    const gid = group.body.data.id as string;

    expect((await follow(app, alice.token, dave.id)).status).toBe(200);
    // dave has blocked bob (an existing member). Adding dave must be refused.
    await block(app, dave.token, bob.id);

    const res = await request(app)
      .post(`/api/groups/${gid}/members`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ userIds: [dave.id] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GROUP_006');

    // Confirm dave was NOT added despite the failed request.
    const detail = await request(app)
      .get(`/api/groups/${gid}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(detail.body.data.members.some((m: { id: string }) => m.id === dave.id)).toBe(false);
  });

  it('addMembers: a batch of two members who blocked each other is refused, neither inserted (GROUP_006)', async () => {
    const alice = await register(app); // owner / adder (unrelated to the block)
    const bob = await register(app);
    const carol = await register(app);
    const dave = await register(app); // D — blocks eve
    const eve = await register(app); // E
    createdIds.push(alice.id, bob.id, carol.id, dave.id, eve.id);

    const group = await createGroup(app, alice.token, [bob.id, carol.id]);
    const gid = group.body.data.id as string;

    await Promise.all([follow(app, alice.token, dave.id), follow(app, alice.token, eve.id)]);
    // D blocks E. They are BOTH new members in the same batch — the old check
    // only compared each new member against existing ones, so this pair passed
    // and both were inserted.
    await block(app, dave.token, eve.id);

    const res = await request(app)
      .post(`/api/groups/${gid}/members`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ userIds: [dave.id, eve.id] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GROUP_006');

    // Neither dave nor eve was added despite the failed request.
    const detail = await request(app)
      .get(`/api/groups/${gid}`)
      .set('Authorization', `Bearer ${alice.token}`);
    const memberIds = detail.body.data.members.map((m: { id: string }) => m.id);
    expect(memberIds).not.toContain(dave.id);
    expect(memberIds).not.toContain(eve.id);
  });

  it('addMembers: an unrelated user is added normally (200)', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    const dave = await register(app);
    createdIds.push(alice.id, bob.id, carol.id, dave.id);

    const group = await createGroup(app, alice.token, [bob.id, carol.id]);
    const gid = group.body.data.id as string;

    expect((await follow(app, alice.token, dave.id)).status).toBe(200);
    const res = await request(app)
      .post(`/api/groups/${gid}/members`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ userIds: [dave.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.members.some((m: { id: string }) => m.id === dave.id)).toBe(true);
  });

  // ── Fix 2: ownership transfer when the owner leaves ──────────────────────
  it('leave: when the owner leaves, ownership passes to the oldest remaining member', async () => {
    const alice = await register(app); // owner (joined first)
    const bob = await register(app); // oldest OTHER member
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);

    const group = await createGroup(app, alice.token, [bob.id, carol.id]);
    const gid = group.body.data.id as string;
    expect(group.body.data.ownerId).toBe(alice.id);

    const leave = await request(app)
      .post(`/api/groups/${gid}/leave`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(leave.status).toBe(200);
    expect(leave.body.data.left).toBe(true);

    // bob (added before carol) is now the owner and can exercise owner-only
    // powers (removeMember), proving ownership is no longer orphaned.
    const detail = await request(app)
      .get(`/api/groups/${gid}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(detail.body.data.ownerId).toBe(bob.id);

    const removeAsNewOwner = await request(app)
      .delete(`/api/groups/${gid}/members/${carol.id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(removeAsNewOwner.status).toBe(200);
  });

  it('leave: the group is deleted once the last member leaves', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);

    const group = await createGroup(app, alice.token, [bob.id, carol.id]);
    const gid = group.body.data.id as string;

    for (const u of [alice, bob, carol]) {
      await request(app).post(`/api/groups/${gid}/leave`).set('Authorization', `Bearer ${u.token}`);
    }

    const gone = await prisma.conversation.findUnique({ where: { id: gid } });
    expect(gone).toBeNull();
  });

  // ── Fix 3: rename with an empty title reverts to the auto name (null) ─────
  it('rename: an empty title clears the custom name back to null', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);

    const group = await createGroup(app, alice.token, [bob.id, carol.id], 'Named group');
    const gid = group.body.data.id as string;
    expect(group.body.data.title).toBe('Named group');

    const cleared = await request(app)
      .patch(`/api/groups/${gid}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ title: '   ' }); // whitespace-only → null
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.title).toBeNull();

    // A non-empty rename still works.
    const renamed = await request(app)
      .patch(`/api/groups/${gid}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ title: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.title).toBe('Renamed');
  });

  it('keeps every equal-timestamp group message across a composite-cursor boundary', async () => {
    const alice = await register(app);
    const bob = await register(app);
    const carol = await register(app);
    createdIds.push(alice.id, bob.id, carol.id);
    const group = await createGroup(app, alice.token, [bob.id, carol.id]);
    const groupId = group.body.data.id as string;
    const timestamp = new Date('2026-08-10T12:00:00.456Z');
    const prefix = `group_tie_${rand()}`;
    const ids = ['a', 'b', 'c', 'd'].map(suffix => `${prefix}_${suffix}`);
    await prisma.groupMessage.createMany({
      data: ids.map((id, index) => ({
        id,
        conversationId: groupId,
        senderId: alice.id,
        content: `tied group ${index}`,
        createdAt: timestamp,
      })),
    });

    const seen: string[] = [];
    let before: string | undefined;
    let pageCount = 0;

    do {
      const page = await request(app)
        .get(`/api/groups/${groupId}/messages`)
        .query({ limit: 2, paginated: 'true', ...(before ? { before } : {}) })
        .set('Authorization', `Bearer ${alice.token}`);

      expect(page.status).toBe(200);
      if (pageCount === 0) expect(page.body.data.nextCursor).toMatch(/^v1\./);
      seen.push(...page.body.data.data.map((message: { id: string }) => message.id));
      before = page.body.data.nextCursor ?? undefined;
      pageCount += 1;
      expect(pageCount).toBeLessThan(10);
    } while (before);

    const tiedSeen = seen.filter(id => ids.includes(id));
    expect(new Set(tiedSeen)).toEqual(new Set(ids));
    expect(tiedSeen).toHaveLength(ids.length);
  });
});
