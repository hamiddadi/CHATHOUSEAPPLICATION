/**
 * Workflow: Adhésion Club (join → privacy gate → approve/reject).
 * Couvre join OPEN, PRIVATE bloqué (CLUB_003), accept sans invite (CLUB_007),
 * et les anomalies CLUB-01 (bypass SOCIAL) et CLUB-03 (membre invite en privé).
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
  const username = `wfc_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

const createClub = async (
  app: Express,
  owner: { token: string },
  privacy: 'OPEN' | 'SOCIAL' | 'PRIVATE',
) => {
  const res = await request(app)
    .post('/api/clubs')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: `Club ${rand()}`, privacy });
  return res.body.data.id as string;
};

describe('Workflow — adhésion club', () => {
  let app: Express;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    // La suppression de l'owner cascade Club + ClubMember.
    for (const id of createdUserIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it("transition valide : join d'un club OPEN", async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    createdUserIds.push(owner.id, joiner.id);
    const clubId = await createClub(app, owner, 'OPEN');

    const join = await request(app)
      .post(`/api/clubs/${clubId}/join`)
      .set('Authorization', `Bearer ${joiner.token}`);
    expect(join.status).toBe(200);
    expect(join.body.data.joined).toBe(true);
  });

  it("transition invalide : join direct d'un club PRIVÉ est bloqué (CLUB_003)", async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    createdUserIds.push(owner.id, joiner.id);
    const clubId = await createClub(app, owner, 'PRIVATE');

    const join = await request(app)
      .post(`/api/clubs/${clubId}/join`)
      .set('Authorization', `Bearer ${joiner.token}`);
    expect(join.status).toBe(403);
    expect(join.body.error.code).toBe('CLUB_003');
  });

  it('RBAC : accepter sans invitation valide est refusé (CLUB_007)', async () => {
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    createdUserIds.push(owner.id, outsider.id);
    const clubId = await createClub(app, owner, 'PRIVATE');

    const accept = await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(accept.status).toBe(403);
    expect(accept.body.error.code).toBe('CLUB_007');
  });

  // ── ANOMALIE CLUB-01 (majeure) ────────────────────────────────────────
  // Un club SOCIAL devrait nécessiter une approbation (PENDING_REQUEST). Le
  // core join() ne bloque que PRIVATE → SOCIAL accorde l'adhésion immédiate,
  // contournant entièrement la garde d'approbation (vivant seulement dans
  // l'extension clubreq).
  it("CLUB-01 : le join direct d'un club SOCIAL ne devrait PAS accorder l'adhésion immédiate", async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    createdUserIds.push(owner.id, joiner.id);
    const clubId = await createClub(app, owner, 'SOCIAL');

    const join = await request(app)
      .post(`/api/clubs/${clubId}/join`)
      .set('Authorization', `Bearer ${joiner.token}`);

    // Attendu : refusé / mis en attente, PAS un 200 {joined:true}.
    expect(join.status).toBe(403);
  });

  // ── ANOMALIE CLUB-03 (majeure) ────────────────────────────────────────
  // Inviter dans un club PRIVÉ devrait être réservé à OWNER/ADMIN. invite() ne
  // vérifie que l'existence de l'appartenance → un simple MEMBER peut faire
  // entrer n'importe qui.
  it('CLUB-03 : un simple MEMBER ne devrait PAS pouvoir inviter dans un club PRIVÉ', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const outsider = await registerUser(app);
    createdUserIds.push(owner.id, member.id, outsider.id);
    const clubId = await createClub(app, owner, 'PRIVATE');

    // L'owner invite `member`, qui accepte → MEMBER (rôle de base).
    await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userIds: [member.id] });
    await request(app)
      .post(`/api/clubs/${clubId}/accept`)
      .set('Authorization', `Bearer ${member.token}`);

    // Le MEMBER tente d'inviter un tiers → DOIT être refusé.
    const invite = await request(app)
      .post(`/api/clubs/${clubId}/invite`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ userIds: [outsider.id] });

    expect(invite.status).toBe(403);
  });
});
