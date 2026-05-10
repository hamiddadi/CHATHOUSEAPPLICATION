import { z } from 'zod';

export const reportSchema = z.object({
  // Mirrors the Prisma ReportReason enum; the frontend sends lowercase
  // values for ergonomics and we uppercase on the way in.
  reason: z.enum(['spam', 'harassment', 'fake_profile', 'other']),
  details: z.string().max(2000).optional(),
});

export const reportRoomSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'fake_profile', 'other']),
  details: z.string().max(2000).optional(),
});

export type ReportInput = z.infer<typeof reportSchema>;
export type ReportRoomInput = z.infer<typeof reportRoomSchema>;
