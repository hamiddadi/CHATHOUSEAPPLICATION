import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { env } from '../../config/env';
import { createRateLimiter } from '../../middlewares/rateLimit.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import { isValidMediaSignature } from './media-url';
import { mediaService } from './media.service';
import type { ByteRange } from './object-storage';

const mediaLimiter = createRateLimiter('rl:media-read:', {
  windowMs: 60_000,
  max: 300,
});

const parseRange = (header: string | undefined, size: number): ByteRange | null | 'invalid' => {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';

  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (!rawStart && !rawEnd) return 'invalid';

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return 'invalid';
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
};

export const mediaRouter: Router = Router();
mediaRouter.use(mediaLimiter);

const servePrivateMedia = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const id = req.params['id'];
  const signature = req.params['signature'];
  const expires = req.params['expires'];
  if (expires === undefined) {
    const legacyUntil = env.MEDIA_LEGACY_STABLE_READ_UNTIL
      ? Date.parse(env.MEDIA_LEGACY_STABLE_READ_UNTIL)
      : 0;
    if (Date.now() >= legacyUntil) {
      res.status(404).end();
      return;
    }
  }
  if (
    typeof id !== 'string' ||
    typeof signature !== 'string' ||
    (expires !== undefined && typeof expires !== 'string') ||
    !isValidMediaSignature(id, signature, expires)
  ) {
    res.status(404).end();
    return;
  }

  // Fetch metadata first so suffix/open-ended ranges can be normalized
  // against the authoritative byte length without downloading the object.
  const metadata = await mediaService.getMetadataForRead(id);
  const range = parseRange(req.get('range'), metadata.sizeBytes);
  if (range === 'invalid') {
    res.setHeader('Content-Range', `bytes */${metadata.sizeBytes}`);
    res.status(416).end();
    return;
  }

  const opened = await mediaService.openForRead(metadata, range ?? undefined);

  res.status(range ? 206 : 200);
  res.setHeader('Content-Type', opened.mimeType);
  res.setHeader('Content-Length', String(opened.contentLength));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (opened.contentRange) res.setHeader('Content-Range', opened.contentRange);

  opened.body.on('error', err => {
    if (!res.headersSent) next(err);
    else res.destroy(err);
  });
  opened.body.pipe(res);
};

// GDPR exports receive short-lived links. Stable signed URLs remain supported
// for app-owned avatar/voice records until those persisted references migrate
// to opaque media ids.
mediaRouter.get('/:id/:expires/:signature', asyncHandler(servePrivateMedia));
mediaRouter.get('/:id/:signature', asyncHandler(servePrivateMedia));
