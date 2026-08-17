import { z } from 'zod';
import { publicContentString } from '../../utils/publicContentModeration';
import { decodeChatCursor } from './chat.cursor';

export const sendMessageSchema = z.object({
  content: publicContentString(z.string().min(1).max(2000)),
});

// Voice DM: the client uploads to /upload/voice first, then posts the stored
// URL + clip length. durationMs capped at 5 min to match the client recorder.
export const sendVoiceMessageSchema = z.object({
  audioUrl: z.string().url().max(2048),
  durationMs: z.number().int().min(300).max(300_000),
});

export const listMessagesSchema = z.object({
  // New clients use an opaque (createdAt,id) cursor. Exact legacy ISO
  // timestamps remain accepted across rolling backend/mobile deployments.
  before: z
    .string()
    .refine(value => decodeChatCursor(value) !== null, { message: 'Invalid message cursor' })
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  // Preserve the historical bare-array response unless explicitly requested.
  paginated: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SendVoiceMessageInput = z.infer<typeof sendVoiceMessageSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
