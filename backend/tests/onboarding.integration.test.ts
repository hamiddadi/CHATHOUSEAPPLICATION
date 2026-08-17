import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { mediaService } =
  require('../src/modules/media/media.service') as typeof import('../src/modules/media/media.service');
const { connectRedis, disconnectRedis } =
  require('../src/config/redis') as typeof import('../src/config/redis');
const { contactsService } =
  require('../src/extensions/modules/contacts/contacts.service') as typeof import('../src/extensions/modules/contacts/contacts.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const registerUser = async (app: Express) => {
  const username = `ob_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    username,
    token: res.body.data.accessToken as string,
  };
};

describe('Onboarding integration — interests + completion flag', () => {
  let app: Express;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await mediaService.deleteAllForUser(id).catch(() => undefined);
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('new user starts with hasCompletedOnboarding=false, empty interests, returned via /users/me', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);

    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${u.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.hasCompletedOnboarding).toBe(false);
    expect(me.body.data.interests).toEqual([]);
  });

  it('normalizes username writes and treats case-only variants as unavailable', async () => {
    const owner = await registerUser(app);
    const requester = await registerUser(app);
    createdUserIds.push(owner.id, requester.id);
    const mixed = `Case_${rand()}`;

    const set = await request(app)
      .patch('/api/users/me/username')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ username: mixed });
    expect(set.status).toBe(200);
    expect(set.body.data.username).toBe(mixed.toLowerCase());

    const check = await request(app)
      .get(`/api/users/check-username?q=${encodeURIComponent(mixed.toUpperCase())}`)
      .set('Authorization', `Bearer ${requester.token}`);
    expect(check.status).toBe(200);
    expect(check.body.data.available).toBe(false);
  });

  it('keeps contact discovery opt-in off and validates explicit privacy updates', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);

    const initial = await request(app)
      .get('/api/users/me/contact-discovery')
      .set('Authorization', `Bearer ${u.token}`);
    expect(initial.status).toBe(200);
    expect(initial.body.data.allowContactDiscovery).toBe(false);

    const enabled = await request(app)
      .patch('/api/users/me/contact-discovery')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ allowContactDiscovery: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.data.allowContactDiscovery).toBe(true);

    const ambiguous = await request(app)
      .patch('/api/users/me/contact-discovery')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ allowContactDiscovery: 'false' });
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error.code).toBe('VALIDATION_001');
  });

  it('matches only phone-bound users who explicitly opted into discovery', async () => {
    const requester = await registerUser(app);
    const visible = await registerUser(app);
    const hidden = await registerUser(app);
    createdUserIds.push(requester.id, visible.id, hidden.id);
    const phoneSuffix = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    const requesterPhone = `+1554${phoneSuffix}`;
    const visiblePhone = `+1555${phoneSuffix}`;
    const hiddenPhone = `+1556${phoneSuffix}`;
    await Promise.all([
      prisma.user.update({
        where: { id: requester.id },
        data: { phoneNumber: requesterPhone, hasCompletedOnboarding: true },
      }),
      prisma.user.update({
        where: { id: visible.id },
        data: { phoneNumber: visiblePhone, allowContactDiscovery: true },
      }),
      prisma.user.update({
        where: { id: hidden.id },
        data: { phoneNumber: hiddenPhone, allowContactDiscovery: false },
      }),
    ]);

    const matches = (await contactsService.match(requester.id, [
      visiblePhone,
      hiddenPhone,
    ])) as Array<{
      id: string;
    }>;
    expect(matches.map(match => match.id)).toEqual([visible.id]);
  });

  it('PATCH /users/me/interests lowercases + dedupes + caps at 10', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);

    const ok = await request(app)
      .patch('/api/users/me/interests')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ interests: ['TECH', 'Design', 'tech', 'Music'] });
    expect(ok.status).toBe(200);
    // Normalised: lowercase, duplicates removed, order preserved.
    expect(ok.body.data.interests).toEqual(['tech', 'design', 'music']);

    const tooMany = Array.from({ length: 11 }, (_, i) => `cat${i}`);
    const bad = await request(app)
      .patch('/api/users/me/interests')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ interests: tooMany });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_001');

    const empty = await request(app)
      .patch('/api/users/me/interests')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ interests: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_001');
  });

  it('PATCH /users/me/onboarding merges profile fields + interests + flips flag', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);

    const upload = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ dataUrl: TINY_PNG_DATA_URL });
    expect(upload.status).toBe(201);
    const avatarUrl = upload.body.data.url as string;

    const res = await request(app)
      .patch('/api/users/me/onboarding')
      .set('Authorization', `Bearer ${u.token}`)
      .send({
        displayName: 'Casey Echo',
        bio: 'Building things at night.',
        avatarUrl,
        // completeOnboardingSchema requires at least 3 interests (matches the
        // frontend InterestSelection minimum).
        interests: ['Tech', 'music', 'Art'],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.hasCompletedOnboarding).toBe(true);
    expect(res.body.data.displayName).toBe('Casey Echo');
    expect(res.body.data.bio).toBe('Building things at night.');
    expect(res.body.data.avatarUrl).toBe(avatarUrl);
    expect(res.body.data.interests).toEqual(['tech', 'music', 'art']);

    // Survives a subsequent /me read (persisted, not just echoed). All three
    // normalised interests persist — the immediate response (above) and the
    // re-read must agree (the prior `['tech', 'music']` here dropped 'art' and
    // contradicted line 105 — a test bug, not a cap in completeOnboarding).
    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${u.token}`);
    expect(me.body.data.hasCompletedOnboarding).toBe(true);
    expect(me.body.data.interests).toEqual(['tech', 'music', 'art']);
  });

  it('PATCH /users/me/onboarding with empty body still flips the flag (minimum onboarding path)', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);

    const res = await request(app)
      .patch('/api/users/me/onboarding')
      .set('Authorization', `Bearer ${u.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.hasCompletedOnboarding).toBe(true);
    expect(res.body.data.interests).toEqual([]);
  });

  it('rejects invalid avatarUrl (VALIDATION_001)', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);
    const res = await request(app)
      .patch('/api/users/me/onboarding')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ avatarUrl: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_001');
  });

  it('requires auth — no token returns AUTH_003', async () => {
    const res = await request(app).patch('/api/users/me/onboarding').send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_003');
  });
});
