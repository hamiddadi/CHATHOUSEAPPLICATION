import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { RequestHandler } from 'express';

const MIN_PRODUCTION_TOKEN_BYTES = 32;

export interface MetricsTokenOptions {
  inlineToken?: string;
  tokenFile?: string;
}

const normalizeToken = (raw: string, source: string): string => {
  const token = raw.trim();
  if (!token) {
    throw new Error(`${source} must contain a non-empty metrics token`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(token)) {
    throw new Error(`${source} must not contain control characters`);
  }
  return token;
};

/**
 * Load the metrics credential once at application startup.
 *
 * Production Compose uses METRICS_TOKEN_FILE so the secret never appears in
 * the container environment. METRICS_TOKEN remains supported for local and
 * legacy deployments, but configuring both sources is rejected to avoid an
 * ambiguous credential during rotation.
 */
export const resolveMetricsToken = ({
  inlineToken = process.env.METRICS_TOKEN,
  tokenFile = process.env.METRICS_TOKEN_FILE,
}: MetricsTokenOptions = {}): string | undefined => {
  const normalizedFile = tokenFile?.trim();
  const hasInlineToken = Boolean(inlineToken?.trim());

  if (hasInlineToken && normalizedFile) {
    throw new Error('Configure only one of METRICS_TOKEN or METRICS_TOKEN_FILE');
  }

  if (normalizedFile) {
    // Operator-controlled deployment config; the path is never derived from a request.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return normalizeToken(readFileSync(normalizedFile, { encoding: 'utf8' }), 'METRICS_TOKEN_FILE');
  }

  return hasInlineToken ? normalizeToken(inlineToken as string, 'METRICS_TOKEN') : undefined;
};

const hasValidBearer = (authorization: string | undefined, token: string): boolean => {
  if (!authorization?.startsWith('Bearer ')) return false;

  const provided = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
};

export interface MetricsAuthOptions extends MetricsTokenOptions {
  production: boolean;
}

/**
 * Protect GET /metrics without leaking whether a token was absent or invalid.
 * Non-production stays open only when no token source is configured.
 */
export const createMetricsAuthMiddleware = ({
  production,
  inlineToken,
  tokenFile,
}: MetricsAuthOptions): RequestHandler => {
  const token = resolveMetricsToken({ inlineToken, tokenFile });

  if (production && token && Buffer.byteLength(token, 'utf8') < MIN_PRODUCTION_TOKEN_BYTES) {
    throw new Error(
      `Metrics token must be at least ${MIN_PRODUCTION_TOKEN_BYTES} bytes in production`,
    );
  }

  return (req, res, next) => {
    if (!token) {
      if (production) {
        res.status(403).end();
        return;
      }
      next();
      return;
    }

    if (!hasValidBearer(req.get('authorization'), token)) {
      res.status(403).end();
      return;
    }

    next();
  };
};
