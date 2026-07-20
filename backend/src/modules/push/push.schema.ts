import { z } from 'zod';

export const registerPushSchema = z.object({
  token: z.string().trim().min(32).max(4096),
  platform: z.enum(['ios', 'android']),
});

export const unregisterPushSchema = z.object({
  token: z.string().trim().min(32).max(4096),
});

export type RegisterPushInput = z.infer<typeof registerPushSchema>;
export type UnregisterPushInput = z.infer<typeof unregisterPushSchema>;
