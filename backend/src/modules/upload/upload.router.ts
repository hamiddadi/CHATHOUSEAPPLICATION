import { Router, json as expressJson } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { requireAuth } from '../../middlewares/auth.middleware';
import { sendOk } from '../../utils/response';
import { uploadService } from './upload.service';

export const uploadRouter: Router = Router();

// Avatar payloads are base64 JSON, which is ~33% larger than the raw image.
// The global parser caps bodies at 1 MB (app.ts), far too small for a ~5 MB
// image (~6.7 MB encoded), so this router installs its own 8 MB JSON parser
// BEFORE requireAuth. Scoped to /api/upload only — it never relaxes the limit
// for the rest of the API.
uploadRouter.use(expressJson({ limit: '8mb' }));

uploadRouter.use(requireAuth);

// Accept either a single data URL (`data:image/jpeg;base64,...`) or an
// explicit { base64, mime } pair. The service does the real mime/size
// validation (VALIDATION_001); here we just assert the wire shape.
const avatarBodySchema = z
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
    const body = avatarBodySchema.parse(req.body);
    // Request-derived origin; the service prefers PUBLIC_URL when set so the
    // returned link is correct behind a proxy/CDN in production.
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = uploadService.uploadAvatar(body, origin);
    sendOk(res, result, 201);
  }),
);
