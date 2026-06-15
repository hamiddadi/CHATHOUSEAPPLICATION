import { z } from 'zod';

// Single source of truth for the club privacy enum so create + update can't
// drift (create previously rejected SOCIAL while update accepted it — a club
// could be flipped to SOCIAL but never created as one).
export const clubPrivacyEnum = z.enum(['OPEN', 'SOCIAL', 'PRIVATE']);

export const createClubSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(500).optional(),
  rules: z.string().max(2000).optional(),
  privacy: clubPrivacyEnum.default('OPEN'),
  category: z.string().max(32).default('tech'),
  categoryEmoji: z.string().max(8).default('🏠'),
  iconUrl: z.string().url().max(500).nullish(),
});

export const listClubsSchema = z.object({
  filter: z.enum(['mine', 'discover']).default('mine'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const inviteSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
});

export const updateClubSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  description: z.string().max(500).optional(),
  rules: z.string().max(2000).nullish(),
  privacy: clubPrivacyEnum.optional(),
  category: z.string().max(32).optional(),
  categoryEmoji: z.string().max(8).optional(),
  iconUrl: z.string().url().max(500).nullish(),
});

export const setMemberRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member']),
});

export type CreateClubInput = z.infer<typeof createClubSchema>;
export type ListClubsInput = z.infer<typeof listClubsSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type UpdateClubInput = z.infer<typeof updateClubSchema>;
export type SetMemberRoleInput = z.infer<typeof setMemberRoleSchema>;
