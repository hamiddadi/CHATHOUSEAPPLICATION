import { z } from 'zod';

export const registerPushSchema = z.object({
  token: z.string().min(1).max(256),
  platform: z.enum(['ios', 'android', 'expo', 'web']),
});

export const unregisterPushSchema = z.object({
  token: z.string().min(1).max(256),
});

export type RegisterPushInput = z.infer<typeof registerPushSchema>;
export type UnregisterPushInput = z.infer<typeof unregisterPushSchema>;
