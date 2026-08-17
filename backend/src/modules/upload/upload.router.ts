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
export const MAX_UPLOAD_JSON_BYTES = 6 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS_PER_USER = 2;
const activeUploads = new Map<string, number>();

// Avatar + voice-note payloads are base64 JSON, ~33% larger than the raw
// bytes. The global parser caps bodies at 1 MB (app.ts); this authenticated
// route permits bounded 2 MB images or 4 MB voice clips once base64-encoded.
// Authentication and per-user rate limiting happen BEFORE parsing a potentially
// large body, so unauthenticated traffic cannot consume the base64 memory budget.
uploadRouter.use(requireAuth);
uploadRouter.use(requireCurrentLegalAcceptance);
uploadRouter.use(uploadLimiter);
uploadRouter.use((req, res, next) => {
  const userId = authedUserId(req);
  const active = activeUploads.get(userId) ?? 0;
  if (active >= MAX_CONCURRENT_UPLOADS_PER_USER) {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMIT_001', message: 'Too many concurrent uploads' },
    });
    return;
  }
  activeUploads.set(userId, active + 1);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    const remaining = (activeUploads.get(userId) ?? 1) - 1;
    if (remaining <= 0) activeUploads.delete(userId);
    else activeUploads.set(userId, remaining);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
});
uploadRouter.use((req, res, next) => {
  const rawLength = req.get('content-length');
  if (rawLength !== undefined) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_001', message: 'Invalid Content-Length' },
      });
      return;
    }
    if (contentLength > MAX_UPLOAD_JSON_BYTES) {
      res.status(413).json({
        success: false,
        error: { code: 'UPLOAD_001', message: 'Uploaded media is too large' },
      });
      return;
    }
  }
  next();
});
uploadRouter.use(expressJson({ limit: MAX_UPLOAD_JSON_BYTES }));

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
    const result = await uploadService.uploadAvatar(
      authedUserId(req),
      body,
      origin,
      req.get('Idempotency-Key'),
    );
    sendOk(res, result, 201);
  }),
);

// Voice notes for async "Chats". Same wire shape as the avatar route (data URL
// or { base64, mime }); the service enforces audio MIME + the 4 MB ceiling.
uploadRouter.post(
  '/voice',
  asyncHandler(async (req: Request, res: Response) => {
    const body = uploadBodySchema.parse(req.body);
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await uploadService.uploadVoice(
      authedUserId(req),
      body,
      origin,
      req.get('Idempotency-Key'),
    );
    sendOk(res, result, 201);
  }),
);
