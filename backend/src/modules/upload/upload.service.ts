import { MediaKind } from '@prisma/client';
import { AppError } from '../../middlewares/error.middleware';
import { mediaService } from '../media/media.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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

interface UploadInput {
  dataUrl?: string;
  base64?: string;
  mime?: string;
}

interface DecodedMedia {
  mime: string;
  extension: string;
  buffer: Buffer;
}

const parseDataUrl = (dataUrl: string): { mime: string; base64: string } | null => {
  const match = /^data:([a-z0-9.+/-]+);base64,(.*)$/is.exec(dataUrl.trim());
  const mime = match?.[1];
  const base64 = match?.[2];
  return mime && base64 !== undefined ? { mime: mime.toLowerCase(), base64 } : null;
};

const extractPayload = (input: UploadInput): { mime: string; base64: string } => {
  if (typeof input.dataUrl === 'string' && input.dataUrl.length > 0) {
    const parsed = parseDataUrl(input.dataUrl);
    if (!parsed) throw new AppError('VALIDATION_001', 'Malformed data URL');
    return parsed;
  }
  if (
    typeof input.base64 === 'string' &&
    input.base64.length > 0 &&
    typeof input.mime === 'string' &&
    input.mime.length > 0
  ) {
    return { mime: input.mime.toLowerCase(), base64: input.base64 };
  }
  throw new AppError('VALIDATION_001', 'Missing media data or MIME type');
};

const decodeBase64 = (base64: string, maxBytes: number, label: string): Buffer => {
  const clean = base64.replace(/\s/g, '');
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4 + 4;
  if (clean.length === 0) throw new AppError('VALIDATION_001', `Empty ${label} data`);
  if (clean.length > maxEncodedLength) {
    throw new AppError('UPLOAD_001', `${label} exceeds the upload limit`);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) {
    throw new AppError('VALIDATION_001', `Malformed ${label} base64`);
  }

  const buffer = Buffer.from(clean, 'base64');
  if (buffer.byteLength === 0) throw new AppError('VALIDATION_001', `Empty ${label} data`);
  if (buffer.byteLength > maxBytes) {
    throw new AppError('UPLOAD_001', `${label} exceeds the upload limit`);
  }
  return buffer;
};

const hasAscii = (buffer: Buffer, offset: number, value: string): boolean =>
  buffer.subarray(offset, offset + value.length).toString('ascii') === value;

const isValidImageBytes = (mime: string, buffer: Buffer): boolean => {
  if (mime === 'image/jpeg') {
    return buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mime === 'image/png') {
    return (
      buffer.byteLength >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }
  return (
    mime === 'image/webp' &&
    buffer.byteLength >= 12 &&
    hasAscii(buffer, 0, 'RIFF') &&
    hasAscii(buffer, 8, 'WEBP')
  );
};

const isValidAudioBytes = (mime: string, buffer: Buffer): boolean => {
  if (mime === 'audio/m4a' || mime === 'audio/x-m4a' || mime === 'audio/mp4') {
    return buffer.byteLength >= 12 && hasAscii(buffer, 4, 'ftyp');
  }
  if (mime === 'audio/3gpp') {
    return buffer.byteLength >= 12 && hasAscii(buffer, 4, 'ftyp');
  }
  if (mime === 'audio/aac') {
    return buffer.byteLength >= 2 && buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xf6) === 0xf0;
  }
  if (mime === 'audio/mpeg') {
    return (
      (buffer.byteLength >= 3 && hasAscii(buffer, 0, 'ID3')) ||
      (buffer.byteLength >= 2 && buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0)
    );
  }
  if (mime === 'audio/wav' || mime === 'audio/x-wav') {
    return buffer.byteLength >= 12 && hasAscii(buffer, 0, 'RIFF') && hasAscii(buffer, 8, 'WAVE');
  }
  if (mime === 'audio/webm') {
    return (
      buffer.byteLength >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    );
  }
  return mime === 'audio/x-caf' && buffer.byteLength >= 4 && hasAscii(buffer, 0, 'caff');
};

const decodeMedia = (
  input: UploadInput,
  allowedTypes: Record<string, string>,
  maxBytes: number,
  label: string,
  validateMagicBytes: (mime: string, buffer: Buffer) => boolean,
): DecodedMedia => {
  const { mime, base64 } = extractPayload(input);
  const extension = allowedTypes[mime];
  if (!extension) throw new AppError('VALIDATION_001', `Unsupported ${label} type`);

  const buffer = decodeBase64(base64, maxBytes, label);
  if (!validateMagicBytes(mime, buffer)) {
    throw new AppError('VALIDATION_001', `${label} content does not match its MIME type`);
  }
  return { mime, extension, buffer };
};

export const decodeAvatar = (input: UploadInput): DecodedMedia =>
  decodeMedia(input, IMAGE_MIME_EXT, MAX_IMAGE_BYTES, 'Image', isValidImageBytes);

export const decodeAudio = (input: UploadInput): DecodedMedia =>
  decodeMedia(input, AUDIO_MIME_EXT, MAX_AUDIO_BYTES, 'Voice note', isValidAudioBytes);

export const uploadService = {
  async uploadAvatar(
    ownerId: string,
    input: UploadInput,
    requestOrigin: string,
    idempotencyKey?: string,
  ): Promise<{ id: string; url: string }> {
    const media = decodeAvatar(input);
    return mediaService.store({
      ownerId,
      kind: MediaKind.AVATAR,
      extension: media.extension,
      mimeType: media.mime,
      body: media.buffer,
      requestOrigin,
      idempotencyKey,
    });
  },

  async uploadVoice(
    ownerId: string,
    input: UploadInput,
    requestOrigin: string,
    idempotencyKey?: string,
  ): Promise<{ id: string; url: string }> {
    const media = decodeAudio(input);
    return mediaService.store({
      ownerId,
      kind: MediaKind.VOICE,
      extension: media.extension,
      mimeType: media.mime,
      body: media.buffer,
      requestOrigin,
      idempotencyKey,
    });
  },
};
