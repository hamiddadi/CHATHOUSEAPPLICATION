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
const { mediaService } =
  require('../src/modules/media/media.service') as typeof import('../src/modules/media/media.service');
const { expiringMediaUrlFor } =
  require('../src/modules/media/media-url') as typeof import('../src/modules/media/media-url');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');

const register = async (app: Express) => {
  const username = `up_${rand()}`;
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
    token: result.body.data.accessToken as string,
  };
};

describe('Private media uploads', () => {
  let app: Express;
  const userIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const userId of userIds) {
      // Remove object bytes before the FK cascade removes their metadata.
      await mediaService.deleteAllForUser(userId).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('authenticates before accepting a large upload body', async () => {
    const result = await request(app).post('/api/upload/avatar').send({ dataUrl: PNG_DATA_URL });
    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe('AUTH_003');
  });

  it('stores valid bytes privately and serves only the signed capability URL', async () => {
    const user = await register(app);
    userIds.push(user.id);

    const uploaded = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ dataUrl: PNG_DATA_URL });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data).toEqual({
      id: expect.any(String),
      url: expect.stringMatching(/\/media\/[^/]+\/[^/]+$/),
    });

    const path = new URL(uploaded.body.data.url as string).pathname;
    const read = await request(app).get(path);
    expect(read.status).toBe(200);
    expect(read.headers['content-type']).toMatch(/^image\/png/);
    expect(read.headers['cache-control']).toContain('private');
    expect(read.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.isBuffer(read.body)).toBe(true);
    expect(read.body).toEqual(PNG_BYTES);

    const range = await request(app).get(path).set('Range', 'bytes=0-7');
    expect(range.status).toBe(206);
    expect(range.headers['content-range']).toBe(`bytes 0-7/${PNG_BYTES.byteLength}`);
    expect(range.body).toEqual(PNG_BYTES.subarray(0, 8));

    const invalidSignature = await request(app).get(
      `/media/${uploaded.body.data.id as string}/invalid-signature`,
    );
    expect(invalidSignature.status).toBe(404);

    const temporaryUrl = expiringMediaUrlFor(uploaded.body.data.id as string, 'http://localhost');
    const temporaryPath = new URL(temporaryUrl).pathname;
    expect(temporaryPath).toMatch(/^\/media\/[^/]+\/\d{10}\/[^/]+$/);
    const temporaryRead = await request(app).get(temporaryPath);
    expect(temporaryRead.status).toBe(200);

    const temporaryParts = temporaryPath.split('/');
    temporaryParts[3] = String(Number(temporaryParts[3]) - 1);
    const tamperedExpiry = await request(app).get(temporaryParts.join('/'));
    expect(tamperedExpiry.status).toBe(404);
  });

  it('replays an upload at the exact same object and rejects key reuse with changed bytes', async () => {
    const user = await register(app);
    userIds.push(user.id);
    const idempotencyKey = `avatar-upload-${rand()}-${rand()}`;

    const first = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ dataUrl: PNG_DATA_URL });
    const replay = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ dataUrl: PNG_DATA_URL });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.data).toEqual(first.body.data);
    expect(
      await prisma.mediaObject.count({
        where: { ownerId: user.id, kind: 'AVATAR' },
      }),
    ).toBe(1);

    const changedPng = Buffer.concat([PNG_BYTES, Buffer.from([0])]).toString('base64');
    const conflict = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ base64: changedPng, mime: 'image/png' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_001');
    expect(
      await prisma.mediaObject.count({
        where: { ownerId: user.id, kind: 'AVATAR' },
      }),
    ).toBe(1);
  });

  it('exports private media through expiring links without stable capabilities', async () => {
    const user = await register(app);
    userIds.push(user.id);

    const uploaded = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ dataUrl: PNG_DATA_URL });
    expect(uploaded.status).toBe(201);

    const profile = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ avatarUrl: uploaded.body.data.url });
    expect(profile.status).toBe(200);

    const exported = await request(app)
      .get('/api/users/me/export')
      .set('Authorization', `Bearer ${user.token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toMatch(
      /^attachment; filename="chathouse-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(exported.headers['transfer-encoding']).toBe('chunked');
    expect(exported.headers['cache-control']).toBe('private, no-store');
    expect(exported.headers['x-content-type-options']).toBe('nosniff');
    expect(exported.body.exportFormat).toBe('chathouse-user-export-v4');
    expect(exported.body.retention.mediaDownloadUrlTtlSeconds).toBeGreaterThanOrEqual(300);
    expect(exported.body.profile.avatarUrl).toBeUndefined();
    expect(exported.body.profile.avatarMedia).toEqual({
      mediaId: uploaded.body.data.id,
      downloadUrl: expect.stringMatching(/\/media\/[^/]+\/\d{10}\/[^/]+$/),
    });
    expect(exported.body.privateMedia[0].downloadUrl).toMatch(/\/media\/[^/]+\/\d{10}\/[^/]+$/);
    expect(JSON.stringify(exported.body)).not.toContain(uploaded.body.data.url as string);

    const downloadPath = new URL(exported.body.profile.avatarMedia.downloadUrl as string).pathname;
    const downloaded = await request(app).get(downloadPath);
    expect(downloaded.status).toBe(200);
    expect(downloaded.body).toEqual(PNG_BYTES);
  });

  it('rejects MIME spoofing and another user reusing the signed URL', async () => {
    const owner = await register(app);
    const attacker = await register(app);
    userIds.push(owner.id, attacker.id);

    const spoof = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ base64: PNG_BASE64, mime: 'image/jpeg' });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error.code).toBe('VALIDATION_001');

    const uploaded = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ dataUrl: PNG_DATA_URL });
    expect(uploaded.status).toBe(201);

    const hijack = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${attacker.token}`)
      .send({ avatarUrl: uploaded.body.data.url });
    expect(hijack.status).toBe(400);
    expect(hijack.body.error.code).toBe('VALIDATION_001');
  });

  it('stops serving retained media as soon as account deletion is requested', async () => {
    const user = await register(app);
    userIds.push(user.id);

    const uploaded = await request(app)
      .post('/api/upload/avatar')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ dataUrl: PNG_DATA_URL });
    expect(uploaded.status).toBe(201);
    const path = new URL(uploaded.body.data.url as string).pathname;

    const deletion = await request(app)
      .post('/api/users/me/request-deletion')
      .set('Authorization', `Bearer ${user.token}`);
    expect(deletion.status).toBe(200);

    const hidden = await request(app).get(path);
    expect(hidden.status).toBe(404);
  });
});
