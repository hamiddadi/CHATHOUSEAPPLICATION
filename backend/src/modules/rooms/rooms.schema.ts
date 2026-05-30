import { z } from 'zod';

export const createRoomSchema = z
  .object({
    title: z.string().min(3).max(120),
    description: z.string().max(500).optional(),
    topic: z.string().max(60).optional(),
    // Topic tags (aligned with User.interests). Max 5 keeps the scoring
    // well-balanced and the payload small.
    topics: z.array(z.string().min(1).max(32)).max(5).default([]),
    // User ids promoted to SPEAKER on room creation. Host + co-hosts
    // collectively cap at 6 speakers before the audience queue kicks in.
    coHostIds: z.array(z.string().min(1)).max(5).default([]),
    isPrivate: z.boolean().default(false),
    roomType: z.enum(['OPEN', 'SOCIAL', 'CLOSED']).default('OPEN'),
    chatEnabled: z.boolean().default(true),
    // TODO(phase-N): Dead flag. No server-side media recording pipeline exists yet.
    recordingEnabled: z.boolean().default(false),
    maxSpeakers: z.number().int().min(1).max(50).default(10),
    clubId: z.string().min(1).optional(),
    // ISO 8601 datetime. When present, the room is created as a scheduled
    // event (isLive=false until the reminder worker flips it on).
    scheduledFor: z.string().datetime({ offset: true }).optional(),
  })
  .refine(v => v.scheduledFor === undefined || new Date(v.scheduledFor).getTime() > Date.now(), {
    message: 'scheduledFor must be in the future',
    path: ['scheduledFor'],
  })
  .refine(v => !v.coHostIds.includes(''), {
    message: 'coHostIds cannot contain empty strings',
    path: ['coHostIds'],
  });

export const sendRoomMessageSchema = z.object({
  content: z.string().trim().min(1).max(500),
  replyToId: z.string().min(1).optional(),
});

export const updateRoomTitleSchema = z.object({
  title: z.string().trim().min(3).max(120),
});

export const toggleRoomChatSchema = z.object({
  chatEnabled: z.boolean().optional(),
  // 'all' / 'mods' on the wire matches the lowercased UI vocabulary;
  // service layer maps to the Prisma RoomChatVisibility enum.
  chatVisibility: z.enum(['all', 'mods']).optional(),
});

export const muteAllSchema = z.object({
  // Optional: include the host themselves. By default the host is exempted
  // (you don't want to silence the moderator about to call the room to order).
  includeHost: z.boolean().default(false),
});

export const inviteToRoomSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
});

export const sendReactionSchema = z.object({
  // Short emoji — covers most pictographs and ZWJ sequences up to 16 chars.
  emoji: z.string().min(1).max(16),
});

export const listRoomsSchema = z.object({
  live: z.coerce.boolean().optional(),
  filter: z.enum(['live', 'upcoming', 'mine']).optional(),
  clubId: z.string().min(1).optional(),
  // When true, restrict the hallway feed to club-attached rooms only.
  clubs: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const updateRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['HOST', 'MODERATOR', 'SPEAKER', 'LISTENER']),
});

export const muteSchema = z.object({
  isMuted: z.boolean(),
  // Optional target — when present, the caller must be host or moderator.
  // Omitted = self-mute.
  userId: z.string().min(1).optional(),
});

export const kickSchema = z.object({
  userId: z.string().min(1),
  // Optional ban duration in minutes (0/null = permanent). Defaults to
  // 30 min — long enough to discourage immediate re-join, short enough
  // that an honest mistake doesn't lock the user out forever.
  banMinutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 7)
    .optional(),
  reason: z.string().max(500).optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type ListRoomsInput = z.infer<typeof listRoomsSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type MuteInput = z.infer<typeof muteSchema>;
export type KickInput = z.infer<typeof kickSchema>;
export type SendRoomMessageInput = z.infer<typeof sendRoomMessageSchema>;
export type SendReactionInput = z.infer<typeof sendReactionSchema>;
export type UpdateRoomTitleInput = z.infer<typeof updateRoomTitleSchema>;
export type ToggleRoomChatInput = z.infer<typeof toggleRoomChatSchema>;
export type MuteAllInput = z.infer<typeof muteAllSchema>;
export type InviteToRoomInput = z.infer<typeof inviteToRoomSchema>;
