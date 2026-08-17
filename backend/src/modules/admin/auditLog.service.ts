import type { AuditAction, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../config/database';
import { logger } from '../../config/logger';

type AuditLogClient = Pick<Prisma.TransactionClient, 'auditLog'>;

interface RecordInput {
  actorId: string;
  action: AuditAction;
  targetUserId?: string | null;
  targetRoomId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

const truncate = (s: string | null | undefined, max: number): string | null => {
  if (!s) return null;
  return s.length <= max ? s : s.slice(0, max);
};

/**
 * Append-only audit trail for privileged actions. Persistence is fail-closed;
 * mutation callers pass their transaction client so state and its audit row
 * commit or roll back together.
 */
export const auditLogService = {
  async record(input: RecordInput, client: AuditLogClient = prisma): Promise<void> {
    try {
      await client.auditLog.create({
        data: {
          actorId: input.actorId,
          action: input.action,
          targetUserId: input.targetUserId ?? null,
          targetRoomId: input.targetRoomId ?? null,
          targetType: truncate(input.targetType, 32),
          targetId: input.targetId ?? null,
          metadata: input.metadata ?? undefined,
          ip: truncate(input.ip, 64),
          userAgent: truncate(input.userAgent, 500),
        },
      });
    } catch (err) {
      logger.error('audit-log: persist failed', {
        action: input.action,
        actorId: input.actorId,
        err: err instanceof Error ? err.message : err,
      });
      throw err;
    }
  },

  /**
   * Read the IP and user-agent from an Express request in a single call so
   * controllers don't repeat the boilerplate. `trust proxy` is set on the
   * app so `req.ip` reflects the X-Forwarded-For client.
   */
  context(req: Request): { ip: string | null; userAgent: string | null } {
    return {
      ip: req.ip ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    };
  },
};
