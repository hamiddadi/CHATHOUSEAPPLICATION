import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { authLimiter, sendLimiter } from '../../middlewares/rateLimit.middleware';
import { otpController } from '../otp/otp.controller';
import { authController } from './auth.controller';

export const authRouter: Router = Router();

// Email + password flow (legacy, kept for the existing tests).
authRouter.post('/register', authLimiter, asyncHandler(authController.register));
authRouter.post('/login', authLimiter, asyncHandler(authController.login));
authRouter.post('/refresh', authLimiter, asyncHandler(authController.refresh));
authRouter.post('/logout', requireAuth, asyncHandler(authController.logout));
// Sends an email — cap successful sends too (sendLimiter), not just failures.
authRouter.post('/forgot-password', sendLimiter, asyncHandler(authController.forgotPassword));
authRouter.post('/reset-password', authLimiter, asyncHandler(authController.resetPassword));

// Phone + OTP flow (Module 1 — Clubhouse-parity signup).
// send-otp sends an SMS — cap successful sends too (sendLimiter).
authRouter.post('/send-otp', sendLimiter, asyncHandler(otpController.send));
authRouter.post('/verify-otp', authLimiter, asyncHandler(otpController.verify));

// Dev-only shortcut — service refuses when NODE_ENV === 'production'.
// Creates/reuses a `devuser` account so QA on Expo Go can skip the OTP
// round-trip. Returns the same envelope shape as verify-otp. Still rate
// limited so a misconfigured non-prod deploy can't be hammered.
authRouter.post('/dev-login', authLimiter, asyncHandler(authController.devLogin));
