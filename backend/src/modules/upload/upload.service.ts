import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../middlewares/error.middleware';

/**
 * Local-disk avatar storage — zero external deps (no multer, no S3 SDK).
 *
 * Files land in `<repo>/backend/uploads/<uuid>.<ext>` and are served back as
 * static assets by `app.use('/uploads', express.static(UPLOADS_DIR))` (wired
 * in app.ts). `__dirname` resolves identically from `src/modules/upload`
 * (ts-node) and `dist/modules/upload` (compiled), so the path is stable in
 * dev and prod. The directory is git-ignored and created on demand.
 *
 * PRODUCTION NOTE: behind a reverse proxy / load balancer the request
 * protocol+host may be the internal address. To emit a correct public URL,
 * set PUBLIC_URL (e.g. `https://api.chathouse.app`) and prefer it over the
 * request-derived origin — see `publicUrlFor` below. Local disk is also not
 * shared across instances; swap this module for object storage (S3/GCS) when
 * you scale horizontally. The router is the only caller, so the contract
 * ({ url }) stays put when you do.
 */
export const UPLOADS_DIR = path.resolve(__dirname, '../../../uploads');

// Decoded byte ceiling. Base64 inflates ~33%, so a ~5 MB image arrives as
// ~6.7 MB of text — the router's 8 MB JSON limit covers that envelope.
const MAX_DECODED_BYTES = 5 * 1024 * 1024;

// Allowed image MIME types → file extension. Anything else is rejected.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface DecodedImage {
  mime: string;
  ext: string;
  buffer: Buffer;
}

/**
 * Pull the mime + base64 payload out of a `data:<mime>;base64,<data>` URL.
 * Returns null when the string isn't a data URL so the caller can fall back
 * to the explicit `{ base64, mime }` shape.
 */
const parseDataUrl = (dataUrl: string): { mime: string; base64: string } | null => {
  const match = /^data:([a-z0-9.+/-]+);base64,(.*)$/is.exec(dataUrl.trim());
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  if (!mime || base64 === undefined) return null;
  return { mime: mime.toLowerCase(), base64 };
};

/**
 * Validate + decode an avatar payload. Accepts either a data URL or an
 * explicit base64 + mime pair. Throws VALIDATION_001 for an unsupported mime
 * or an over-size image.
 */
export const decodeAvatar = (input: {
  dataUrl?: string;
  base64?: string;
  mime?: string;
}): DecodedImage => {
  let mime: string | undefined;
  let base64: string | undefined;

  if (typeof input.dataUrl === 'string' && input.dataUrl.length > 0) {
    const parsed = parseDataUrl(input.dataUrl);
    if (!parsed) throw new AppError('VALIDATION_001', 'Malformed data URL');
    mime = parsed.mime;
    base64 = parsed.base64;
  } else if (typeof input.base64 === 'string' && input.base64.length > 0) {
    base64 = input.base64;
    mime = typeof input.mime === 'string' ? input.mime.toLowerCase() : undefined;
  }

  if (!base64 || !mime) {
    throw new AppError('VALIDATION_001', 'Missing image data');
  }

  const ext = MIME_EXT[mime];
  if (!ext) {
    throw new AppError('VALIDATION_001', 'Unsupported image type (jpeg, png, webp only)');
  }

  // `base64` decoding is lenient — strip whitespace so a padded/wrapped
  // payload doesn't inflate the size estimate or corrupt the buffer.
  const clean = base64.replace(/\s/g, '');
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.byteLength === 0) {
    throw new AppError('VALIDATION_001', 'Empty image data');
  }
  if (buffer.byteLength > MAX_DECODED_BYTES) {
    throw new AppError('VALIDATION_001', 'Image exceeds 5MB limit');
  }

  return { mime, ext, buffer };
};

/**
 * Persist a decoded image to the uploads directory and return its filename
 * (`<uuid>.<ext>`). Creates the directory on first write.
 */
export const saveAvatar = (image: DecodedImage): string => {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  // Filename is fully server-generated: a random UUID + a whitelisted
  // extension (jpg|png|webp), joined to the fixed UPLOADS_DIR. No
  // user-controlled path segment reaches the FS, so there's no traversal
  // surface for the security/detect-non-literal-fs-filename rule to flag.
  const filename = `${randomUUID()}.${image.ext}`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(path.join(UPLOADS_DIR, filename), image.buffer);
  return filename;
};

// ─── Voice notes (async "Chats") ───────────────────────────────────────────
// Decoded byte ceiling for a voice clip. A multi-minute AAC note stays well
// under this; the router's 12 MB JSON limit covers the ~33% base64 inflation.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

// Allowed audio container MIME types → file extension. expo-audio's
// HIGH_QUALITY preset records .m4a (AAC) on both iOS and Android; the others
// are tolerated so a different recorder/codec still uploads cleanly.
const AUDIO_MIME_EXT: Record<string, string> = {
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/3gpp': '3gp',
  'audio/x-caf': 'caf',
};

export interface DecodedAudio {
  mime: string;
  ext: string;
  buffer: Buffer;
}

/**
 * Validate + decode a voice-note payload. Accepts either a data URL or an
 * explicit base64 + mime pair (mirrors {@link decodeAvatar}). Throws
 * VALIDATION_001 for an unsupported mime or an over-size clip.
 */
export const decodeAudio = (input: {
  dataUrl?: string;
  base64?: string;
  mime?: string;
}): DecodedAudio => {
  let mime: string | undefined;
  let base64: string | undefined;

  if (typeof input.dataUrl === 'string' && input.dataUrl.length > 0) {
    const parsed = parseDataUrl(input.dataUrl);
    if (!parsed) throw new AppError('VALIDATION_001', 'Malformed data URL');
    mime = parsed.mime;
    base64 = parsed.base64;
  } else if (typeof input.base64 === 'string' && input.base64.length > 0) {
    base64 = input.base64;
    mime = typeof input.mime === 'string' ? input.mime.toLowerCase() : undefined;
  }

  if (!base64 || !mime) {
    throw new AppError('VALIDATION_001', 'Missing audio data');
  }

  const ext = AUDIO_MIME_EXT[mime];
  if (!ext) {
    throw new AppError('VALIDATION_001', 'Unsupported audio type');
  }

  const clean = base64.replace(/\s/g, '');
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.byteLength === 0) {
    throw new AppError('VALIDATION_001', 'Empty audio data');
  }
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new AppError('VALIDATION_001', 'Voice note exceeds 8MB limit');
  }

  return { mime, ext, buffer };
};

/**
 * Persist a decoded voice note. Shares the uploads dir + server-generated
 * `<uuid>.<ext>` naming with {@link saveAvatar}, so there's no user-controlled
 * path segment (no traversal surface).
 */
export const saveVoice = (audio: DecodedAudio): string => {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `${randomUUID()}.${audio.ext}`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(path.join(UPLOADS_DIR, filename), audio.buffer);
  return filename;
};

/**
 * Build the public URL for a stored upload. Prefers PUBLIC_URL (set this in
 * production behind a proxy/CDN so the link points at the externally-reachable
 * host); otherwise derives the origin from the request's protocol + host.
 */
export const publicUrlFor = (origin: string, filename: string): string => {
  const base = (process.env['PUBLIC_URL'] || origin).replace(/\/+$/, '');
  return `${base}/uploads/${filename}`;
};

export const uploadService = {
  /**
   * Validate, decode, and store an avatar. Returns the public URL the client
   * should persist as `avatarUrl`.
   */
  uploadAvatar(
    input: { dataUrl?: string; base64?: string; mime?: string },
    origin: string,
  ): { url: string } {
    const image = decodeAvatar(input);
    const filename = saveAvatar(image);
    return { url: publicUrlFor(origin, filename) };
  },

  /**
   * Validate, decode, and store a voice note. Returns the public URL the
   * client attaches to the voice message it then sends to /groups or /chat.
   */
  uploadVoice(
    input: { dataUrl?: string; base64?: string; mime?: string },
    origin: string,
  ): { url: string } {
    const audio = decodeAudio(input);
    const filename = saveVoice(audio);
    return { url: publicUrlFor(origin, filename) };
  },
};
