import { z } from 'zod';

/**
 * Zod schemas backing the auth forms. Kept feature-local so both the RHF
 * resolvers and any server-shape narrowing draw from the same source of
 * truth. The `.transform(s => s.trim())` on each field normalizes input
 * before the resolver validates the rest.
 */

// Strict E.164 — server rejects anything else. We strip spaces/dashes/
// parens during transform so the user-facing input remains forgiving
// ("+33 6 12 34 56 78") while the wire value is always canonical.
const E164 = /^\+[1-9][0-9]{1,14}$/;

export const phoneFormSchema = z.object({
  phoneNumber: z
    .string()
    .transform(s => s.replace(/[\s\-()]/g, ''))
    .pipe(z.string().min(1, 'auth.phone.errors.required').regex(E164, 'auth.phone.errors.invalid')),
  ageConfirmed: z.boolean().refine(v => v === true, {
    message: 'auth.phone.errors.ageVerification',
  }),
});

export const otpFormSchema = z.object({
  code: z
    .string()
    .transform(s => s.trim())
    .pipe(
      z
        .string()
        .min(1, 'auth.otp.errors.required')
        .regex(/^[0-9]{6}$/, 'auth.otp.errors.invalid'),
    ),
});

const USERNAME_REGEX = /^[a-z0-9_]+$/i;

export const usernameFormSchema = z.object({
  username: z
    .string()
    .transform(s => s.trim())
    .pipe(
      z
        .string()
        .min(1, 'auth.username.errors.required')
        .min(3, 'auth.username.errors.tooShort')
        .max(24, 'auth.username.errors.tooLong')
        .regex(USERNAME_REGEX, 'auth.username.errors.format'),
    ),
});

export type PhoneFormValues = z.infer<typeof phoneFormSchema>;
export type OtpFormValues = z.infer<typeof otpFormSchema>;
export type UsernameFormValues = z.infer<typeof usernameFormSchema>;
