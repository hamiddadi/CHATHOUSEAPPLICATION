import { z } from 'zod';

// E.164 — plus sign + 2-15 digits, no spaces/dashes. Client normalizes before
// sending (libphonenumber on the frontend); backend enforces strict format.
const phoneRegex = /^\+[1-9][0-9]{1,14}$/;

export const sendOtpSchema = z.object({
  phoneNumber: z.string().regex(phoneRegex, 'phoneNumber must be E.164 (e.g. +14155551234)'),
});

export const verifyOtpSchema = z.object({
  phoneNumber: z.string().regex(phoneRegex),
  code: z.string().regex(/^[0-9]{6}$/, 'code must be 6 digits'),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
