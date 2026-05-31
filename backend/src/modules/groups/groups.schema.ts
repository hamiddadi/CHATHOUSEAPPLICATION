import { z } from 'zod';

export const createGroupSchema = z.object({
  // Optional group name; when omitted the client falls back to member names.
  title: z.string().trim().min(1).max(80).optional(),
  // The OTHER members (the creator is added implicitly). A group is 3+ people,
  // so we require at least two others — a single pick is a 1:1 DM instead.
  memberIds: z.array(z.string().min(1)).min(2).max(50),
});

export const sendGroupMessageSchema = z.object({
  content: z.string().trim().min(1).max(2000),
});

export const listGroupMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  // ISO 8601 cursor — return messages strictly older than this.
  before: z.string().datetime({ offset: true }).optional(),
});

export const addGroupMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
});

export const renameGroupSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type SendGroupMessageInput = z.infer<typeof sendGroupMessageSchema>;
export type ListGroupMessagesInput = z.infer<typeof listGroupMessagesSchema>;
export type AddGroupMembersInput = z.infer<typeof addGroupMembersSchema>;
export type RenameGroupInput = z.infer<typeof renameGroupSchema>;
