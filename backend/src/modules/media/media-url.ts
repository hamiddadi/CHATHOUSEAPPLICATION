import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

const signatureFor = (mediaId: string): string =>
  createHmac('sha256', env.MEDIA_URL_SIGNING_SECRET ?? env.JWT_ACCESS_SECRET)
    .update(`media:v1:${mediaId}`)
    .digest('base64url');

const expiringSignatureFor = (mediaId: string, expiresAt: string): string =>
  createHmac('sha256', env.MEDIA_URL_SIGNING_SECRET ?? env.JWT_ACCESS_SECRET)
    .update(`media:v2:${mediaId}:${expiresAt}`)
    .digest('base64url');

const publicBase = (requestOrigin: string): string =>
  (env.PUBLIC_URL ?? requestOrigin).replace(/\/+$/, '');

export const mediaUrlFor = (mediaId: string, requestOrigin: string): string => {
  return `${publicBase(requestOrigin)}/media/${mediaId}/${signatureFor(mediaId)}`;
};

export const expiringMediaUrlFor = (mediaId: string, requestOrigin: string): string => {
  const expiresAt = String(Math.floor(Date.now() / 1000) + env.MEDIA_EXPORT_URL_TTL_SECONDS);
  return `${publicBase(requestOrigin)}/media/${mediaId}/${expiresAt}/${expiringSignatureFor(
    mediaId,
    expiresAt,
  )}`;
};

export const isValidMediaSignature = (
  mediaId: string,
  candidate: string,
  expiresAt?: string,
): boolean => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;
  if (expiresAt !== undefined) {
    if (!/^\d{10}$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000)) {
      return false;
    }
  }
  const expected = Buffer.from(
    expiresAt === undefined ? signatureFor(mediaId) : expiringSignatureFor(mediaId, expiresAt),
  );
  const actual = Buffer.from(candidate);
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
};
