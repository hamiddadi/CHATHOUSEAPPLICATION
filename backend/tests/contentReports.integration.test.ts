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
const { adminService } =
  require('../src/modules/admin/admin.service') as typeof import('../src/modules/admin/admin.service');
const { mediaService } =
  require('../src/modules/media/media.service') as typeof import('../src/modules/media/media.service');
/* eslint-enable @typescript-eslint/no-require-imports */

const random = () => Math.random().toString(36).slice(2, 10);

interface TestUser {
  id: string;
  token: string;
}

describe('Individual content reports', () => {
  let app: Express;
  const userIds: string[] = [];

  const register = async (): Promise<TestUser> => {
    const username = `report_${random()}`;
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username,
        email: `${username}@test.local`,
        password: 'test-password-123',
      });
    const user = {
      id: response.body.data.user.id as string,
      token: response.body.data.accessToken as string,
    };
    userIds.push(user.id);
    return user;
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await connectRedis();
    app = createApp();
  });

  afterAll(async () => {
    for (const userId of userIds) {
      await mediaService.deleteAllForUser(userId).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await disconnectRedis();
  });

  it('reports a received DM, snapshots evidence and keeps it after message deletion', async () => {
    const reporter = await register();
    const author = await register();
    const outsider = await register();
    const message = await prisma.message.create({
      data: {
        senderId: author.id,
        receiverId: reporter.id,
        content: 'abusive direct message',
      },
    });

    const response = await request(app)
      .post(`/api/chat/messages/${message.id}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'harassment' });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      reportId: expect.any(String),
      alreadyReported: false,
    });
    const stored = await prisma.report.findUnique({
      where: { id: response.body.data.reportId as string },
    });
    expect(stored).toMatchObject({
      reporterId: reporter.id,
      targetKind: 'DIRECT_MESSAGE',
      contentAuthorId: author.id,
      reportedMessageId: message.id,
      contentSnapshot: 'abusive direct message',
      contentKind: 'TEXT',
      reason: 'HARASSMENT',
    });

    // Idempotent retry: no duplicate queue item.
    const retry = await request(app)
      .post(`/api/chat/messages/${message.id}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'harassment' });
    expect(retry.status).toBe(201);
    expect(retry.body.data).toEqual({
      reportId: response.body.data.reportId,
      alreadyReported: true,
    });

    const selfReport = await request(app)
      .post(`/api/chat/messages/${message.id}/report`)
      .set(auth(author.token))
      .send({ reason: 'other' });
    expect(selfReport.status).toBe(403);
    expect(selfReport.body.error.code).toBe('REPORT_001');

    const inaccessible = await request(app)
      .post(`/api/chat/messages/${message.id}/report`)
      .set(auth(outsider.token))
      .send({ reason: 'spam' });
    expect(inaccessible.status).toBe(404);
    expect(inaccessible.body.error.code).toBe('REPORT_002');

    await prisma.message.delete({ where: { id: message.id } });
    const retained = await prisma.report.findUnique({
      where: { id: response.body.data.reportId as string },
    });
    expect(retained?.reportedMessageId).toBe(message.id);
    expect(retained?.contentSnapshot).toBe('abusive direct message');

    const queue = await adminService.listReports({
      status: 'all',
      kind: 'DIRECT_MESSAGE',
      limit: 50,
    });
    expect(queue.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: response.body.data.reportId,
          contentSnapshot: 'abusive direct message',
          contentAuthor: expect.objectContaining({ id: author.id }),
        }),
      ]),
    );
  });

  it('preserves playable DM and group voice evidence after source deletion and exposes it only to admins', async () => {
    const reporter = await register();
    const author = await register();
    const moderator = await register();
    await prisma.user.update({
      where: { id: moderator.id },
      data: { appRole: 'MODERATOR' },
    });

    const voiceBytes = Buffer.from('RIFF-test-moderation-evidence-WAVE');
    const voice = await mediaService.store({
      ownerId: author.id,
      kind: 'VOICE',
      extension: 'wav',
      mimeType: 'audio/wav',
      body: voiceBytes,
      requestOrigin: 'http://localhost',
    });
    const canonicalVoiceUrl = mediaService.canonicalizeVoiceMediaUrl(voice.url);

    const directMessage = await prisma.message.create({
      data: {
        senderId: author.id,
        receiverId: reporter.id,
        kind: 'VOICE',
        audioUrl: canonicalVoiceUrl,
        audioDurationMs: 8_250,
        mediaObjectId: voice.id,
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        ownerId: author.id,
        title: 'Voice safety group',
        members: { create: [author.id, reporter.id].map(userId => ({ userId })) },
      },
    });
    const groupMessage = await prisma.groupMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: author.id,
        kind: 'VOICE',
        audioUrl: canonicalVoiceUrl,
        audioDurationMs: 8_250,
        mediaObjectId: voice.id,
      },
    });

    const directReport = await request(app)
      .post(`/api/chat/messages/${directMessage.id}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'harassment' });
    const groupReport = await request(app)
      .post(`/api/groups/${conversation.id}/messages/${groupMessage.id}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'spam' });

    expect(directReport.status).toBe(201);
    expect(groupReport.status).toBe(201);
    expect(JSON.stringify(directReport.body)).not.toContain(voice.url);
    expect(JSON.stringify(groupReport.body)).not.toContain(voice.url);

    await prisma.message.delete({ where: { id: directMessage.id } });
    await prisma.groupMessage.delete({ where: { id: groupMessage.id } });

    const retained = await prisma.report.findMany({
      where: { id: { in: [directReport.body.data.reportId, groupReport.body.data.reportId] } },
      orderBy: { targetKind: 'asc' },
    });
    expect(retained).toHaveLength(2);
    expect(retained).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: 'DIRECT_MESSAGE',
          reportedMessageId: directMessage.id,
          contentKind: 'VOICE',
          contentAudioUrl: canonicalVoiceUrl,
          contentMediaObjectId: voice.id,
          contentAudioDurationMs: 8_250,
        }),
        expect.objectContaining({
          targetKind: 'GROUP_MESSAGE',
          reportedGroupMessageId: groupMessage.id,
          contentKind: 'VOICE',
          contentAudioUrl: canonicalVoiceUrl,
          contentMediaObjectId: voice.id,
          contentAudioDurationMs: 8_250,
        }),
      ]),
    );

    const reporterExport = await request(app).get('/api/users/me/export').set(auth(reporter.token));
    expect(reporterExport.status).toBe(200);
    expect(JSON.stringify(reporterExport.body)).not.toContain(voice.url);

    const nonAdminQueue = await request(app)
      .get('/api/admin/reports?status=all')
      .set(auth(reporter.token));
    expect(nonAdminQueue.status).toBe(403);
    expect(nonAdminQueue.body.error.code).toBe('AUTH_008');

    const adminQueue = await request(app)
      .get('/api/admin/reports?status=all')
      .set(auth(moderator.token));
    expect(adminQueue.status).toBe(200);
    const adminRows = adminQueue.body.data.data as Array<{
      id: string;
      contentAudioUrl?: string;
      contentAudioDurationMs?: number;
    }>;
    expect(adminRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: directReport.body.data.reportId,
          contentAudioUrl: expect.stringMatching(/\/media\/[^/]+\/\d{10}\//),
          contentAudioDurationMs: 8_250,
        }),
        expect.objectContaining({
          id: groupReport.body.data.reportId,
          contentAudioUrl: expect.stringMatching(/\/media\/[^/]+\/\d{10}\//),
          contentAudioDurationMs: 8_250,
        }),
      ]),
    );
    const evidenceUrl = adminRows.find(
      row => row.id === directReport.body.data.reportId,
    )?.contentAudioUrl;
    expect(evidenceUrl).toMatch(/\/media\/[^/]+\/\d{10}\//);
    const evidenceRead = await request(app).get(new URL(evidenceUrl!).pathname);
    expect(evidenceRead.status).toBe(200);
    expect(evidenceRead.headers['content-type']).toMatch(/^audio\/wav/);
    expect(evidenceRead.body).toEqual(voiceBytes);
  });

  it('reports a group message only for a current conversation member', async () => {
    const reporter = await register();
    const author = await register();
    const thirdMember = await register();
    const outsider = await register();
    const conversation = await prisma.conversation.create({
      data: {
        ownerId: author.id,
        title: 'Safety test group',
        members: {
          create: [author.id, reporter.id, thirdMember.id].map(userId => ({ userId })),
        },
      },
    });
    const message = await prisma.groupMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: author.id,
        content: 'group spam',
      },
    });

    const response = await request(app)
      .post(`/api/groups/${conversation.id}/messages/${message.id}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'spam' });
    expect(response.status).toBe(201);

    const stored = await prisma.report.findUnique({
      where: { id: response.body.data.reportId as string },
    });
    expect(stored).toMatchObject({
      targetKind: 'GROUP_MESSAGE',
      reportedGroupMessageId: message.id,
      contentAuthorId: author.id,
      contentSnapshot: 'group spam',
      contentContextId: conversation.id,
      contentContextSnapshot: 'Safety test group',
    });

    const denied = await request(app)
      .post(`/api/groups/${conversation.id}/messages/${message.id}/report`)
      .set(auth(outsider.token))
      .send({ reason: 'other' });
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('REPORT_002');
  });

  it('reports a visible room-chat message and rejects non-participants', async () => {
    const author = await register();
    const reporter = await register();
    const outsider = await register();
    const room = await prisma.room.create({
      data: {
        title: 'Room report test',
        hostId: author.id,
        participants: {
          create: [
            { userId: author.id, role: 'HOST' },
            { userId: reporter.id, role: 'LISTENER' },
          ],
        },
      },
    });
    const message = await prisma.roomChatMessage.create({
      data: {
        roomId: room.id,
        userId: author.id,
        content: 'room harassment',
      },
    });

    const response = await request(app)
      .post(`/api/rooms/${room.id}/messages/${message.id}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'harassment', details: 'Repeated abuse' });
    expect(response.status).toBe(201);

    const stored = await prisma.report.findUnique({
      where: { id: response.body.data.reportId as string },
    });
    expect(stored).toMatchObject({
      targetKind: 'ROOM_MESSAGE',
      reportedRoomMessageId: message.id,
      contentAuthorId: author.id,
      contentSnapshot: 'room harassment',
      contentContextId: room.id,
      contentContextSnapshot: 'Room report test',
      details: 'Repeated abuse',
    });

    const denied = await request(app)
      .post(`/api/rooms/${room.id}/messages/${message.id}/report`)
      .set(auth(outsider.token))
      .send({ reason: 'other' });
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('REPORT_002');
  });

  it('mirrors MODS_ONLY room visibility when authorizing a report', async () => {
    const author = await register();
    const listener = await register();
    const moderator = await register();
    const room = await prisma.room.create({
      data: {
        title: 'Moderator-only chat',
        hostId: author.id,
        chatVisibility: 'MODS_ONLY',
        participants: {
          create: [
            { userId: author.id, role: 'HOST' },
            { userId: listener.id, role: 'LISTENER' },
            { userId: moderator.id, role: 'MODERATOR' },
          ],
        },
      },
    });
    const message = await prisma.roomChatMessage.create({
      data: {
        roomId: room.id,
        userId: author.id,
        content: 'moderator-visible message',
      },
    });

    const hiddenFromListener = await request(app)
      .post(`/api/rooms/${room.id}/messages/${message.id}/report`)
      .set(auth(listener.token))
      .send({ reason: 'other' });
    expect(hiddenFromListener.status).toBe(404);
    expect(hiddenFromListener.body.error.code).toBe('REPORT_002');

    const visibleToModerator = await request(app)
      .post(`/api/rooms/${room.id}/messages/${message.id}/report`)
      .set(auth(moderator.token))
      .send({ reason: 'other' });
    expect(visibleToModerator.status).toBe(201);
  });

  it('validates content-report reasons and optional details', async () => {
    const reporter = await register();
    const author = await register();
    const message = await prisma.message.create({
      data: { senderId: author.id, receiverId: reporter.id, content: 'test' },
    });

    const invalidReason = await request(app)
      .post(`/api/chat/messages/${message.id}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'fake_profile' });
    expect(invalidReason.status).toBe(400);
    expect(invalidReason.body.error.code).toBe('VALIDATION_001');

    const blankDetails = await request(app)
      .post(`/api/chat/messages/${message.id}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'other', details: '   ' });
    expect(blankDetails.status).toBe(400);
    expect(blankDetails.body.error.code).toBe('VALIDATION_001');
  });

  it('enforces the migrated target-kind/target-column invariant in PostgreSQL', async () => {
    const reporter = await register();
    const target = await register();

    const constraint = await prisma.$queryRaw<Array<{ convalidated: boolean; definition: string }>>`
      SELECT convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'Report_targetKind_targetColumn_check'
    `;
    expect(constraint).toHaveLength(1);
    expect(constraint[0]).toMatchObject({ convalidated: true });
    expect(constraint[0]?.definition).toContain('DIRECT_MESSAGE');
    expect(constraint[0]?.definition).toContain('reportedGroupMessageId');

    const room = await prisma.room.create({
      data: { title: 'Legacy report compatibility', hostId: target.id },
    });
    await expect(
      prisma.report.create({
        data: {
          reporterId: reporter.id,
          targetKind: 'USER',
          reportedId: target.id,
          reason: 'OTHER',
        },
      }),
    ).resolves.toMatchObject({ targetKind: 'USER', reportedId: target.id });
    await expect(
      prisma.report.create({
        data: {
          reporterId: reporter.id,
          targetKind: 'ROOM',
          reportedRoomId: room.id,
          reason: 'SPAM',
        },
      }),
    ).resolves.toMatchObject({ targetKind: 'ROOM', reportedRoomId: room.id });

    await expect(
      prisma.report.create({
        data: {
          reporterId: reporter.id,
          targetKind: 'USER',
          reportedId: target.id,
          reportedRoomId: 'wrong-extra-target',
          reason: 'OTHER',
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.report.create({
        data: {
          reporterId: reporter.id,
          targetKind: 'GROUP_MESSAGE',
          reportedMessageId: 'wrong-message-column',
          reason: 'SPAM',
        },
      }),
    ).rejects.toThrow();
  });
});
