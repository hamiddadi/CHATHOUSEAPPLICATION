/**
 * Workflow: OTP / Auth — cycle de session (refresh-token rotation).
 * Couvre la rotation valide + réutilisation bloquée (AUTH_004), et les
 * anomalies AUTH-01 (refresh d'un compte suspendu) et AUTH-05 (doublon de
 * casse sur username). Voir docs/qa/RAPPORT-AUDIT-WORKFLOWS.md.
 */
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../../src/app') as typeof import('../../src/app');
const { prisma } =
  require('../../src/config/database') as typeof import('../../src/config/database');
const { connectRedis, disconnectRedis } =
  require('../../src/config/redis') as typeof import('../../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const registerUser = async (app: Express) => {
  const username = `wfa_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return {
    id: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
    refreshToken: res.body.data.refreshToken as string,
  };
};

describe('Workflow — session / refresh-token', () => {
  let app: Express;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('transition valide : rotation du refresh-token + réutilisation bloquée (AUTH_004)', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: u.refreshToken });
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.accessToken).toBeTruthy();
    expect(refresh.body.data.refreshToken).toBeTruthy();
    expect(refresh.body.data.refreshToken).not.toBe(u.refreshToken);

    // L'ancien refresh-token est désormais révoqué : sa réutilisation échoue.
    const reuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: u.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('AUTH_004');
  });

  // ── ANOMALIE AUTH-01 (majeure) ────────────────────────────────────────
  // refresh() ne lit ni suspendedUntil ni deletedAt → un compte suspendu peut
  // continuer à émettre des sessions indéfiniment via /auth/refresh.
  it('AUTH-01 : un compte suspendu ne devrait PAS pouvoir rafraîchir sa session', async () => {
    const u = await registerUser(app);
    createdUserIds.push(u.id);
    // Suspension (jusqu'à demain).
    await prisma.user.update({
      where: { id: u.id },
      data: { suspendedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });

    const refresh = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: u.refreshToken });

    // Attendu : refus (AUTH_007 / 403). Aujourd'hui : 200 + nouvelle paire.
    expect(refresh.status).toBe(403);
    expect(refresh.body.error.code).toBe('AUTH_007');
  });

  // ── ANOMALIE AUTH-05 (mineure) ────────────────────────────────────────
  // username stocké/recherché en casse exacte alors que @unique est sensible
  // à la casse → "Dup_x" et "dup_x" coexistent (doublons + login email/username
  // incohérent). Le second register devrait être refusé (AUTH_006).
  it('AUTH-05 : un username ne différant que par la casse devrait être refusé (AUTH_006)', async () => {
    const upper = `Dup_${rand()}`; // contient une majuscule
    const lower = upper.toLowerCase();

    const first = await request(app)
      .post('/api/auth/register')
      .send({ username: upper, email: `${rand()}@test.local`, password: 'test-password-123' });
    expect(first.status).toBe(201);
    createdUserIds.push(first.body.data.user.id as string);

    const second = await request(app)
      .post('/api/auth/register')
      .send({ username: lower, email: `${rand()}@test.local`, password: 'test-password-123' });
    if (second.body?.data?.user?.id) createdUserIds.push(second.body.data.user.id as string);

    // Attendu : conflit de username insensible à la casse.
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('AUTH_006');
  });
});
