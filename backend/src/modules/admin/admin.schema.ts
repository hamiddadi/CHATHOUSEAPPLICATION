import { z } from 'zod';

export const listUsersSchema = z.object({
  q: z.string().min(1).max(100).optional(),
  role: z.enum(['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']).optional(),
  suspended: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional(),
});

export const setRoleSchema = z.object({
  role: z.enum(['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN']),
});

export const suspendSchema = z.object({
  // 0 / undefined = permanent ban (sentinel year-9999 in service).
  // Otherwise duration in minutes, capped at 1 year.
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 365)
    .optional(),
  reason: z.string().min(1).max(500),
});

export const listAuditLogSchema = z.object({
  actorId: z.string().min(1).optional(),
  targetUserId: z.string().min(1).optional(),
  action: z
    .enum([
      'USER_ROLE_CHANGED',
      'USER_SUSPENDED',
      'USER_UNSUSPENDED',
      'USER_DELETED',
      'ROOM_FORCE_ENDED',
      'REPORT_RESOLVED',
      'REPORT_DISMISSED',
      'GODMODE_ACCESS',
      'IMPERSONATION_STARTED',
      'IMPERSONATION_ENDED',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional(),
});

export const listReportsSchema = z.object({
  status: z.enum(['open', 'resolved', 'all']).default('open'),
  kind: z.enum(['USER', 'ROOM']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional(),
});

export const resolveReportSchema = z.object({
  // Optional moderator note kept on the metadata blob of the audit row.
  notes: z.string().max(500).optional(),
  // 'dismissed' = report invalid / duplicate; 'resolved' = action was taken
  // (the action itself — suspension, room close, etc. — is a separate call).
  outcome: z.enum(['resolved', 'dismissed']),
});

export const listRoomsSchema = z.object({
  live: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const forceEndRoomSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;
export type SetRoleInput = z.infer<typeof setRoleSchema>;
export type SuspendInput = z.infer<typeof suspendSchema>;
export type ListAuditLogInput = z.infer<typeof listAuditLogSchema>;
export type ListReportsInput = z.infer<typeof listReportsSchema>;
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;
export type ListRoomsInput = z.infer<typeof listRoomsSchema>;
export type ForceEndRoomInput = z.infer<typeof forceEndRoomSchema>;
