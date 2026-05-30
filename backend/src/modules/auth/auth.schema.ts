import { z } from 'zod';

export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/i, 'letters, digits and underscores only'),
  // Normalize to lowercase so register's uniqueness check (findUnique by
  // email) stays consistent with login's lowercased email lookup. Without
  // this, 'User@Example.com' and 'user@example.com' are stored as distinct
  // rows and a mixed-case signup can never log in via the email branch.
  email: z
    .string()
    .email()
    .max(180)
    .transform(e => e.toLowerCase()),
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
  // Same lowercase normalization as register so the reset lookup
  // (findUnique by email) matches the stored, normalized address.
  email: z
    .string()
    .email()
    .max(180)
    .transform(e => e.toLowerCase()),
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
