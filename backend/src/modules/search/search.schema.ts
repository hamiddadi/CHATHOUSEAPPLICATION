import { z } from 'zod';

export const searchSchema = z
  .object({
    // .trim() before length checks so a whitespace-only query (' ') fails
    // min(1) instead of firing 3 costly ILIKE '%   %' scans.
    q: z.string().trim().min(1).max(100),
    type: z.enum(['users', 'clubs', 'rooms', 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  // Reject unknown query params (consistent with updateMeSchema).
  .strict();

export type SearchInput = z.infer<typeof searchSchema>;
