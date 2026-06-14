/**
 * Workflow: Follow / demande de suivi.
 * Couvre follow/unfollow, self-follow (USER_003), et les anomalies
 * FOLL-01 (compte privé sans demande) et FOLL-02 (blocage ignoré).
 * Voir docs/qa/RAPPORT-AUDIT-WORKFLOWS.md.
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
  const username = `wff_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

describe('Workflow — follow', () => {
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

  it('transition valide : follow public → unfollow', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    createdUserIds.push(a.id, b.id);

    const follow = await request(app)
      .post(`/api/follow/${b.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(follow.status).toBe(200);
    expect(follow.body.data.following).toBe(true);

    const unfollow = await request(app)
      .delete(`/api/follow/${b.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(unfollow.status).toBe(200);
    expect(unfollow.body.data.following).toBe(false);
  });

  it('transition invalide : se suivre soi-même est bloqué (USER_003)', async () => {
    const a = await registerUser(app);
    createdUserIds.push(a.id);

    const res = await request(app)
      .post(`/api/follow/${a.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_003');
  });

  // ── ANOMALIE FOLL-01 (majeure) ────────────────────────────────────────
  // Suivre un compte PRIVÉ devrait créer une demande PENDING (en attente
  // d'approbation), pas une relation FOLLOWING immédiate. Aujourd'hui
  // follow() ne lit jamais isPrivateAccount → suivi instantané.
  it.failing(
    'FOLL-01 : suivre un compte PRIVÉ ne devrait PAS établir FOLLOWING immédiatement',
    async () => {
      const a = await registerUser(app);
      const b = await registerUser(app);
      createdUserIds.push(a.id, b.id);
      // B passe son compte en privé (écrit en base, sans dépendre de l'extension).
      await prisma.user.update({ where: { id: b.id }, data: { isPrivateAccount: true } });

      const follow = await request(app)
        .post(`/api/follow/${b.id}`)
        .set('Authorization', `Bearer ${a.token}`);

      // Comportement attendu : pas de relation effective avant approbation.
      expect(follow.body.data.following).toBe(false);
    },
  );

  // ── ANOMALIE FOLL-02 (majeure) ────────────────────────────────────────
  // Un utilisateur bloqué ne devrait pas pouvoir (re)créer un edge Follow.
  // follow() ne consulte pas le graphe de blocage → l'edge est recréé et une
  // notif NEW_FOLLOWER part vers celui qui a bloqué.
  it('FOLL-02 : un utilisateur bloqué ne devrait PAS pouvoir suivre le bloqueur', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    createdUserIds.push(a.id, b.id);

    // B bloque A.
    const block = await request(app)
      .post(`/api/users/${a.id}/block`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(block.status).toBe(200);

    // A tente de suivre B → DOIT être refusé.
    const follow = await request(app)
      .post(`/api/follow/${b.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(follow.status).toBe(403);
  });
});
