import { Router, json as expressJson } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { uploadLimiter } from '../../middlewares/rateLimit.middleware';
import { sendOk } from '../../utils/response';
import { authedUserId } from '../../utils/authedUserId';
import { requireCurrentLegalAcceptance } from '../auth/legal-acceptance';
import { uploadService } from './upload.service';

export const uploadRouter: Router = Router();

// Avatar + voice-note payloads are base64 JSON, ~33% larger than the raw
// bytes. The global parser caps bodies at 1 MB (app.ts) — far too small for a
// ~5 MB image (~6.7 MB encoded) or an ~8 MB voice clip (~10.7 MB encoded) — so
// Authentication and per-user rate limiting happen BEFORE parsing a potentially
// large body, so unauthenticated traffic cannot consume the base64 memory budget.
uploadRouter.use(requireAuth);
uploadRouter.use(requireCurrentLegalAcceptance);
uploadRouter.use(uploadLimiter);
uploadRouter.use(expressJson({ limit: '12mb' }));

// Accept either a single data URL (`data:image/jpeg;base64,...`) or an
// explicit { base64, mime } pair. The service does the real mime/size
// validation (VALIDATION_001); here we just assert the wire shape.
export const uploadBodySchema = z
  .object({
    dataUrl: z.string().min(1).optional(),
    base64: z.string().min(1).optional(),
    mime: z.string().min(1).optional(),
  })
  .refine(b => Boolean(b.dataUrl) || Boolean(b.base64), {
    message: 'Provide either dataUrl or base64',
  });

uploadRouter.post(
  '/avatar',
  asyncHandler(async (req: Request, res: Response) => {
    const body = uploadBodySchema.parse(req.body);
    // Request-derived origin; the service prefers PUBLIC_URL when set so the
    // returned link is correct behind a proxy/CDN in production.
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await uploadService.uploadAvatar(authedUserId(req), body, origin);
    sendOk(res, result, 201);
  }),
);

// Voice notes for async "Chats". Same wire shape as the avatar route (data URL
// or { base64, mime }); the service enforces audio mime + the 8 MB ceiling.
uploadRouter.post(
  '/voice',
  asyncHandler(async (req: Request, res: Response) => {
    const body = uploadBodySchema.parse(req.body);
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await uploadService.uploadVoice(authedUserId(req), body, origin);
    sendOk(res, result, 201);
  }),
);
