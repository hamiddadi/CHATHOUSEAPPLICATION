import type { MessageKind, Prisma, ReportReason, ReportTargetKind } from '@prisma/client';
import { prisma } from '../../config/database';
import { redis } from '../../config/redis';
import { AppError } from '../../middlewares/error.middleware';
import type { ContentReportInput } from './contentReports.schema';

const REPORT_COOLDOWN_SECONDS = 24 * 60 * 60;

type ContentTargetKind = Extract<
  ReportTargetKind,
  'DIRECT_MESSAGE' | 'GROUP_MESSAGE' | 'ROOM_MESSAGE'
>;

interface ContentEvidence {
  targetKind: ContentTargetKind;
  contentAuthorId: string;
  contentSnapshot: string | null;
  contentAudioUrl: string | null;
  contentMediaObjectId: string | null;
  contentAudioDurationMs: number | null;
  contentKind: MessageKind;
  contentCreatedAt: Date;
  contentContextId: string | null;
  contentContextSnapshot: string | null;
  targetColumn:
    | { reportedMessageId: string }
    | { reportedGroupMessageId: string }
    | { reportedRoomMessageId: string };
}

const reasonToEnum = (reason: ContentReportInput['reason']): ReportReason => {
  switch (reason) {
    case 'spam':
      return 'SPAM';
    case 'harassment':
      return 'HARASSMENT';
    case 'other':
      return 'OTHER';
  }
};

const targetWhere = (targetColumn: ContentEvidence['targetColumn']): Prisma.ReportWhereInput =>
  targetColumn;

const reportContent = async (
  reporterId: string,
  input: ContentReportInput,
  evidence: ContentEvidence,
) => {
  if (evidence.contentAuthorId === reporterId) throw new AppError('REPORT_001');

  // A report is immutable evidence for one reporter/content pair. Return the
  // existing row on a retry (including after the Redis TTL) rather than
  // creating duplicate moderation work.
  const existing = await prisma.report.findFirst({
    where: {
      reporterId,
      ...targetWhere(evidence.targetColumn),
    },
    select: { id: true },
  });
  if (existing) return { reportId: existing.id, alreadyReported: true as const };

  const messageId = Object.values(evidence.targetColumn)[0];
  const cooldownKey = `report:content:${evidence.targetKind}:${reporterId}:${messageId}`;
  const claimed = await redis.set(cooldownKey, '1', {
    EX: REPORT_COOLDOWN_SECONDS,
    NX: true,
  });
  if (claimed === null) throw new AppError('RATE_LIMIT_001');

  try {
    const row = await prisma.report.create({
      data: {
        reporterId,
        targetKind: evidence.targetKind,
        contentAuthorId: evidence.contentAuthorId,
        contentSnapshot: evidence.contentSnapshot,
        contentAudioUrl: evidence.contentAudioUrl,
        contentMediaObjectId: evidence.contentMediaObjectId,
        contentAudioDurationMs: evidence.contentAudioDurationMs,
        contentKind: evidence.contentKind,
        contentCreatedAt: evidence.contentCreatedAt,
        contentContextId: evidence.contentContextId,
        contentContextSnapshot: evidence.contentContextSnapshot,
        reason: reasonToEnum(input.reason),
        details: input.details ?? null,
        ...evidence.targetColumn,
      },
      select: { id: true },
    });
    return { reportId: row.id, alreadyReported: false as const };
  } catch (error) {
    await redis.del(cooldownKey).catch(() => undefined);
    throw error;
  }
};

export const contentReportsService = {
  async reportDirectMessage(reporterId: string, messageId: string, input: ContentReportInput) {
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        roomId: null,
        sender: { deletedAt: null },
        OR: [{ senderId: reporterId }, { receiverId: reporterId }],
      },
      select: {
        id: true,
        senderId: true,
        receiverId: true,
        content: true,
        audioUrl: true,
        mediaObjectId: true,
        audioDurationMs: true,
        kind: true,
        createdAt: true,
      },
    });
    if (!message) throw new AppError('REPORT_002');

    return reportContent(reporterId, input, {
      targetKind: 'DIRECT_MESSAGE',
      contentAuthorId: message.senderId,
      contentSnapshot: message.content,
      contentAudioUrl: message.kind === 'VOICE' ? message.audioUrl : null,
      contentMediaObjectId: message.kind === 'VOICE' ? message.mediaObjectId : null,
      contentAudioDurationMs: message.kind === 'VOICE' ? message.audioDurationMs : null,
      contentKind: message.kind,
      contentCreatedAt: message.createdAt,
      contentContextId: message.senderId === reporterId ? message.receiverId : message.senderId,
      contentContextSnapshot: null,
      targetColumn: { reportedMessageId: message.id },
    });
  },

  async reportGroupMessage(
    reporterId: string,
    conversationId: string,
    messageId: string,
    input: ContentReportInput,
  ) {
    const message = await prisma.groupMessage.findFirst({
      where: {
        id: messageId,
        conversationId,
        sender: { deletedAt: null },
        conversation: { members: { some: { userId: reporterId } } },
      },
      select: {
        id: true,
        senderId: true,
        content: true,
        audioUrl: true,
        mediaObjectId: true,
        audioDurationMs: true,
        kind: true,
        createdAt: true,
        conversation: { select: { id: true, title: true } },
      },
    });
    if (!message) throw new AppError('REPORT_002');

    return reportContent(reporterId, input, {
      targetKind: 'GROUP_MESSAGE',
      contentAuthorId: message.senderId,
      contentSnapshot: message.content,
      contentAudioUrl: message.kind === 'VOICE' ? message.audioUrl : null,
      contentMediaObjectId: message.kind === 'VOICE' ? message.mediaObjectId : null,
      contentAudioDurationMs: message.kind === 'VOICE' ? message.audioDurationMs : null,
      contentKind: message.kind,
      contentCreatedAt: message.createdAt,
      contentContextId: message.conversation.id,
      contentContextSnapshot: message.conversation.title?.slice(0, 100) ?? null,
      targetColumn: { reportedGroupMessageId: message.id },
    });
  },

  async reportRoomMessage(
    reporterId: string,
    roomId: string,
    messageId: string,
    input: ContentReportInput,
  ) {
    // Match the room-chat read gate exactly: active participant, non-deleted
    // message, and host/mod-only visibility when MODS_ONLY is enabled.
    const message = await prisma.roomChatMessage.findFirst({
      where: {
        id: messageId,
        roomId,
        isDeleted: false,
        user: { deletedAt: null },
        room: {
          AND: [
            { participants: { some: { userId: reporterId, leftAt: null } } },
            {
              OR: [
                { chatVisibility: 'ALL' },
                { hostId: reporterId },
                {
                  participants: {
                    some: {
                      userId: reporterId,
                      leftAt: null,
                      role: 'MODERATOR',
                    },
                  },
                },
              ],
            },
          ],
        },
      },
      select: {
        id: true,
        userId: true,
        content: true,
        createdAt: true,
        room: { select: { id: true, title: true } },
      },
    });
    if (!message) throw new AppError('REPORT_002');

    return reportContent(reporterId, input, {
      targetKind: 'ROOM_MESSAGE',
      contentAuthorId: message.userId,
      contentSnapshot: message.content,
      contentAudioUrl: null,
      contentMediaObjectId: null,
      contentAudioDurationMs: null,
      contentKind: 'TEXT',
      contentCreatedAt: message.createdAt,
      contentContextId: message.room.id,
      contentContextSnapshot: message.room.title.slice(0, 100),
      targetColumn: { reportedRoomMessageId: message.id },
    });
  },
};
