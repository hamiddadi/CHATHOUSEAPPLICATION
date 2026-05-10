import { z } from 'zod';

export const searchSchema = z.object({
  q: z.string().min(1).max(100),
  type: z.enum(['users', 'clubs', 'rooms', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchInput = z.infer<typeof searchSchema>;
