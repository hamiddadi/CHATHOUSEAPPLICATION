/**
 * Placeholder used in logs and observability payloads for bearer-like URL
 * capabilities. Keep it stable so tests and downstream log filters can detect
 * that redaction happened without retaining the credential itself.
 */
export const REDACTED_URL_CAPABILITY = '[REDACTED]';

// Private media is served through one of these capability-bearing routes:
//   /media/:id/:signature
//   /media/:id/:expires/:signature
//
// Match the expiring form first. Both expressions are anchored to the end of
// the path (apart from an optional trailing slash), so an unrelated URL that
// merely contains a `media` segment is not partially rewritten.
const EXPIRING_MEDIA_CAPABILITY = /(\/media\/[^/?#]+\/[^/?#]+\/)[^/?#]+(?=\/?$)/g;
const STABLE_MEDIA_CAPABILITY = /(\/media\/[^/?#]+\/)[^/?#]+(?=\/?$)/g;

/**
 * Return a log-safe request URL.
 *
 * Query strings and fragments are discarded for every route because they can
 * contain search terms, OAuth codes or other personal data. Private-media
 * signatures live in the path, so those capability segments are redacted in
 * both relative Express URLs and absolute observability URLs.
 */
export const sanitizeRequestUrl = (rawUrl: string | undefined): string => {
  if (!rawUrl) return '';

  const pathOnly = rawUrl.split(/[?#]/, 1)[0] ?? '';
  return pathOnly
    .replace(EXPIRING_MEDIA_CAPABILITY, `$1${REDACTED_URL_CAPABILITY}`)
    .replace(STABLE_MEDIA_CAPABILITY, `$1${REDACTED_URL_CAPABILITY}`);
};
