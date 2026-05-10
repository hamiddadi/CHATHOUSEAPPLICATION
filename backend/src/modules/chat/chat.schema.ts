import { z } from 'zod';

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

export const listMessagesSchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
