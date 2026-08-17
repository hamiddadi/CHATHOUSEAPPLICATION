import { Router, type RequestHandler } from 'express';
import { env } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAnySession, requireAuth } from '../../middlewares/auth.middleware';
import { AppError } from '../../middlewares/error.middleware';
import { authLimiter, sendLimiter } from '../../middlewares/rateLimit.middleware';
import { otpController } from '../otp/otp.controller';
import { authController } from './auth.controller';

export const authRouter: Router = Router();

const requireLegacyEmailAuth: RequestHandler = (_req, _res, next) => {
  if (env.NODE_ENV === 'production' || !env.LEGACY_EMAIL_AUTH_ENABLED) {
    return next(new AppError('AUTH_009'));
  }
  next();
};

// Explicitly gated legacy flow for local/test fixtures. Production remains
// phone + OTP only even if the flag is accidentally set there.
authRouter.post(
  '/register',
  requireLegacyEmailAuth,
  authLimiter,
  asyncHandler(authController.register),
);
authRouter.post('/login', requireLegacyEmailAuth, authLimiter, asyncHandler(authController.login));
authRouter.post('/refresh', authLimiter, asyncHandler(authController.refresh));
authRouter.post('/logout', requireAnySession, asyncHandler(authController.logout));
authRouter.post(
  '/legal-acceptance',
  requireAuth,
  authLimiter,
  asyncHandler(authController.acceptLegalDocuments),
);
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
