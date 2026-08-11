import { Router, raw } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { logger } from '../../config/logger';
import { LivekitWebhookAuthenticationError, recordingsService } from './recordings.service';

export const livekitWebhookRouter: Router = Router();

// LiveKit posts egress/room webhooks here with an `Authorization` JWT signed by
// the API secret. Signature verification needs the RAW body, so this router
// installs its own express.raw parser and MUST be mounted before the global
// JSON parser. Unauthenticated by design — LiveKit isn't a logged-in user; the
// signed Authorization header IS the auth (verified in handleWebhook).
livekitWebhookRouter.post(
  '/livekit',
  raw({ type: '*/*', limit: '512kb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    try {
      await recordingsService.handleWebhook(body, req.get('Authorization'));
    } catch (err) {
      if (err instanceof LivekitWebhookAuthenticationError) {
        logger.warn('livekit webhook authentication rejected', { err });
        res.status(401).json({ ok: false });
        return;
      }
      logger.error('livekit webhook processing failed', { err });
      res.set('Retry-After', '1').status(503).json({ ok: false });
      return;
    }
    res.status(200).json({ ok: true });
  }),
);
