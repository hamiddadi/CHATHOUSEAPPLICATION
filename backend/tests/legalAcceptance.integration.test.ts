import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { connectRedis, disconnectRedis } from '../src/config/redis';
import { resolveLegalAcceptance } from '../src/modules/auth/legal-acceptance';
import { usersService } from '../src/modules/users/users.service';

const app = createApp();
const VERSION = '2026-07-29';
const marker = `leg${Date.now().toString(36)}`;

const currentAcceptance = {
  termsAccepted: true,
  privacyNoticeAcknowledged: true,
  legalDocumentVersion: VERSION,
  legalLocale: 'fr-FR',
} as const;

const register = async () => {
  const username = `${marker}-${Math.random().toString(36).slice(2, 8)}`.replace(/-/g, '_');
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      username,
      email: `${username}@example.test`,
      password: 'Legal-test-password-1',
      ageConfirmed: true,
      ...currentAcceptance,
    });
  expect(response.status).toBe(201);
  return {
    userId: response.body.data.user.id as string,
    token: response.body.data.accessToken as string,
  };
};

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
  await disconnectRedis();
});

describe('versioned legal acceptance', () => {
  it('fails closed outside test fixture mode when acceptance is absent', () => {
    const original = env.NODE_ENV;
    Object.assign(env, { NODE_ENV: 'development' });
    try {
      expect(() => resolveLegalAcceptance({})).toThrow(
        'You must accept the current Terms and acknowledge the Privacy Notice',
      );
    } finally {
      Object.assign(env, { NODE_ENV: original });
    }
  });

  it('rejects an explicitly stale version with the current-version conflict', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username: `${marker}_stale`,
        email: `${marker}-stale@example.test`,
        password: 'Legal-test-password-1',
        ageConfirmed: true,
        ...currentAcceptance,
        legalDocumentVersion: '2026-07-28',
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LEGAL_002');
    expect(response.body.error.details).toEqual({ currentVersion: VERSION });
  });

  it('persists Terms acceptance and Privacy Notice acknowledgement separately', async () => {
    const { userId } = await register();
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    expect(stored.termsAcceptedVersion).toBe(VERSION);
    expect(stored.termsAcceptedAt).toBeInstanceOf(Date);
    expect(stored.privacyNoticeAcknowledgedVersion).toBe(VERSION);
    expect(stored.privacyNoticeAcknowledgedAt).toBeInstanceOf(Date);
    expect(stored.legalAcceptanceLocale).toBe('fr-FR');
  });

  it('blocks legacy users from UGC until the authenticated reacceptance endpoint succeeds', async () => {
    const { userId, token } = await register();
    await prisma.user.update({
      where: { id: userId },
      data: {
        termsAcceptedVersion: null,
        termsAcceptedAt: null,
        privacyNoticeAcknowledgedVersion: null,
        privacyNoticeAcknowledgedAt: null,
        legalAcceptanceLocale: null,
      },
    });

    const blocked = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Must not be written' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('LEGAL_001');

    const accepted = await request(app)
      .post('/api/auth/legal-acceptance')
      .set('Authorization', `Bearer ${token}`)
      .send(currentAcceptance);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.legalAcceptanceRequired).toBe(false);

    const allowed = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Now allowed' });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.displayName).toBe('Now allowed');
  });

  it('derives permanentDeletionAt from the configured backend grace period', async () => {
    const { userId } = await register();
    const deletedAt = new Date('2026-07-29T12:00:00.000Z');
    await prisma.user.update({ where: { id: userId }, data: { deletedAt } });

    const me = await usersService.getMe(userId);
    const expected = new Date(
      deletedAt.getTime() + env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(me.permanentDeletionAt).toBe(expected);
  });
});
