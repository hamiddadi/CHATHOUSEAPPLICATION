/**
 * Workflow: Rôles participant (LISTENER ⇄ SPEAKER ⇄ MODERATOR / HOST).
 * Couvre la transition valide, la garde RBAC, et l'anomalie ROOM-01/PART-01.
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
  const username = `wfr_${rand()}`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.local`, password: 'test-password-123' });
  return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
};

describe('Workflow — rôles participant', () => {
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

  /** Crée une room live + y fait entrer `listener`, renvoie le roomId. */
  const setupRoom = async (host: { token: string }, listener: { token: string }) => {
    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: `WF role ${rand()}`, maxSpeakers: 8 });
    const roomId = create.body.data.id as string;
    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${listener.token}`);
    return roomId;
  };

  it('transition valide : le HOST promeut un LISTENER en SPEAKER', async () => {
    const host = await registerUser(app);
    const listener = await registerUser(app);
    createdUserIds.push(host.id, listener.id);
    const roomId = await setupRoom(host, listener);

    const promote = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ userId: listener.id, role: 'SPEAKER' });

    expect(promote.status).toBe(200);
    expect(promote.body.data.role).toBe('SPEAKER');
  });

  it('RBAC : un simple LISTENER ne peut pas changer les rôles (ROOM_003)', async () => {
    const host = await registerUser(app);
    const listener = await registerUser(app);
    const other = await registerUser(app);
    createdUserIds.push(host.id, listener.id, other.id);
    const roomId = await setupRoom(host, listener);
    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${other.token}`);

    const res = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${listener.token}`)
      .send({ userId: other.id, role: 'SPEAKER' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROOM_003');
  });

  // ── ANOMALIE ROOM-01 / PART-01 (majeure) ──────────────────────────────
  // Un MODERATOR ne devrait PAS pouvoir rétrograder le HOST (cohérence avec
  // kick/setMute qui protègent le host). Aujourd'hui setRole ne garde la cible
  // host que pour role=HOST/MODERATOR ; un mod peut donc forcer le host en
  // LISTENER, ce qui désync Room.hostId et coupe l'audio du host.
  // `it.failing` : passe tant que le bug existe ; rouge dès qu'il est corrigé.
  it('ROOM-01/PART-01 : un MODERATOR ne devrait PAS pouvoir rétrograder le HOST en LISTENER', async () => {
    const host = await registerUser(app);
    const mod = await registerUser(app);
    createdUserIds.push(host.id, mod.id);
    const roomId = await setupRoom(host, mod);

    // Le host promeut `mod` en MODERATOR (autorisé au host uniquement).
    const promote = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ userId: mod.id, role: 'MODERATOR' });
    expect(promote.status).toBe(200);

    // Le MODERATOR tente de rétrograder le HOST → DOIT être refusé.
    const demoteHost = await request(app)
      .patch(`/api/rooms/${roomId}/role`)
      .set('Authorization', `Bearer ${mod.token}`)
      .send({ userId: host.id, role: 'LISTENER' });

    expect(demoteHost.status).toBe(403);
    expect(demoteHost.body.error.code).toBe('ROOM_003');
  });
});
