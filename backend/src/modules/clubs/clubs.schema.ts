import { z } from 'zod';
import { publicContentString } from '../../utils/publicContentModeration';

// Single source of truth for the club privacy enum so create + update can't
// drift (create previously rejected SOCIAL while update accepted it — a club
// could be flipped to SOCIAL but never created as one).
export const clubPrivacyEnum = z.enum(['OPEN', 'SOCIAL', 'PRIVATE']);

export const createClubSchema = z.object({
  name: publicContentString(z.string().min(2).max(50)),
  description: publicContentString(z.string().max(500)).optional(),
  rules: publicContentString(z.string().max(2000)).optional(),
  privacy: clubPrivacyEnum.default('OPEN'),
  category: publicContentString(z.string().max(32)).default('tech'),
  categoryEmoji: z.string().max(8).default('🏠'),
  iconUrl: z.string().url().max(500).nullish(),
});

export const listClubsSchema = z.object({
  filter: z.enum(['mine', 'discover']).default('mine'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const inviteSchema = z.object({
  // Empty array is allowed: the endpoint doubles as "mint a shareable invite
  // link" (returns a signed token/URL) with no direct per-user invitations.
  userIds: z.array(z.string().min(1)).max(50).default([]),
});

// Accepting an invitation may carry a signed, stateless invite token (from a
// shared invite link) OR rely on a CLUB_INVITE notification addressed to the
// user. The token is opaque (base64url `<payload>.<sig>`); bound the length so
// a malformed/oversized value is rejected before it reaches the verifier.
export const acceptInviteSchema = z.object({
  inviteToken: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9._~-]+$/)
    .optional(),
});

export const updateClubSchema = z.object({
  name: publicContentString(z.string().min(2).max(50)).optional(),
  description: publicContentString(z.string().max(500)).optional(),
  rules: publicContentString(z.string().max(2000)).nullish(),
  privacy: clubPrivacyEnum.optional(),
  category: publicContentString(z.string().max(32)).optional(),
  categoryEmoji: z.string().max(8).optional(),
  iconUrl: z.string().url().max(500).nullish(),
});

export const setMemberRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'member']),
});

export type CreateClubInput = z.infer<typeof createClubSchema>;
export type ListClubsInput = z.infer<typeof listClubsSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type UpdateClubInput = z.infer<typeof updateClubSchema>;
export type SetMemberRoleInput = z.infer<typeof setMemberRoleSchema>;
