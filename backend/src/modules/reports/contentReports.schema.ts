import { z } from 'zod';

export const contentReportSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'other']),
  details: z.string().trim().min(1).max(2000).optional(),
});

export const contentReportResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    reportId: z.string(),
    alreadyReported: z.boolean(),
  }),
});

export type ContentReportInput = z.infer<typeof contentReportSchema>;
