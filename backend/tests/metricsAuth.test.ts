import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createMetricsAuthMiddleware, resolveMetricsToken } from '../src/monitoring/metricsAuth';

const STRONG_TOKEN = 'a'.repeat(64);
let tempDirectories: string[] = [];

const writeTokenFile = (contents: string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'chathouse-metrics-'));
  tempDirectories.push(directory);
  const tokenFile = join(directory, 'metrics_token');
  // Test-only path created under the OS temporary directory above.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  writeFileSync(tokenFile, contents, { encoding: 'utf8', mode: 0o600 });
  return tokenFile;
};

const buildApp = (options: Parameters<typeof createMetricsAuthMiddleware>[0]): express.Express => {
  const app = express();
  app.get('/metrics', createMetricsAuthMiddleware(options), (_req, res) => {
    res.status(200).send('metrics');
  });
  return app;
};

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories = [];
});

describe('metrics token loading', () => {
  it('loads and trims the token from a secret file', () => {
    const tokenFile = writeTokenFile(`  ${STRONG_TOKEN}\n`);
    expect(resolveMetricsToken({ tokenFile })).toBe(STRONG_TOKEN);
  });

  it('rejects an empty secret file', () => {
    const tokenFile = writeTokenFile(' \n');
    expect(() => resolveMetricsToken({ tokenFile })).toThrow(
      'METRICS_TOKEN_FILE must contain a non-empty metrics token',
    );
  });

  it('rejects ambiguous inline and file sources', () => {
    const tokenFile = writeTokenFile(STRONG_TOKEN);
    expect(() => resolveMetricsToken({ inlineToken: STRONG_TOKEN, tokenFile })).toThrow(
      'Configure only one of METRICS_TOKEN or METRICS_TOKEN_FILE',
    );
  });

  it('rejects a short production token at startup', () => {
    expect(() =>
      createMetricsAuthMiddleware({ production: true, inlineToken: 'too-short' }),
    ).toThrow('Metrics token must be at least 32 bytes in production');
  });
});

describe('metrics authorization middleware', () => {
  it('accepts Prometheus with the shared Bearer token', async () => {
    const tokenFile = writeTokenFile(STRONG_TOKEN);
    const response = await request(buildApp({ production: true, tokenFile }))
      .get('/metrics')
      .set('Authorization', `Bearer ${STRONG_TOKEN}`);

    expect(response.status).toBe(200);
  });

  it('returns the same forbidden response when the token is missing or wrong', async () => {
    const tokenFile = writeTokenFile(STRONG_TOKEN);
    const app = buildApp({ production: true, tokenFile });

    const missing = await request(app).get('/metrics');
    const wrong = await request(app)
      .get('/metrics')
      .set('Authorization', `Bearer ${'b'.repeat(64)}`);

    expect(missing.status).toBe(403);
    expect(wrong.status).toBe(403);
    expect(missing.text).toBe('');
    expect(wrong.text).toBe('');
  });

  it('fails closed in production when no token is configured', async () => {
    const response = await request(buildApp({ production: true })).get('/metrics');
    expect(response.status).toBe(403);
  });

  it('stays open in non-production when no token is configured', async () => {
    const response = await request(buildApp({ production: false })).get('/metrics');
    expect(response.status).toBe(200);
  });
});
