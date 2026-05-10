import { z } from 'zod';

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/i, 'letters, digits and underscores only'),
  email: z.string().email().max(180),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(60).optional(),
});

export const loginSchema = z.object({
  identifier: z.string().min(3).max(180), // email OR username
  password: z.string().min(8).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(180),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  newPassword: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
