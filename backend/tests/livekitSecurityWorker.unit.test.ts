import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import {
  LIVEKIT_PROVIDER_PROBE_STALE_MS,
  LivekitSecurityRuntime,
  LivekitWebhookAuthenticationError,
  createLivekitSecurityHttpServer,
  isLivekitAlreadyAbsent,
  isLivekitSecurityHealthReady,
  parseLivekitSecurityWorkerEnv,
  refreshLivekitProviderHealth,
} from '../src/workers/livekitSecurity.worker';

const minimalEnv = {
  DATABASE_URL: 'postgresql://worker:password@postgres:5432/chathouse?schema=public',
  LIVEKIT_URL: 'wss://livekit.chathouse.app',
  LIVEKIT_INTERNAL_URL: 'http://livekit:7880',
  LIVEKIT_API_KEY: 'production-key',
  LIVEKIT_API_SECRET: 'a'.repeat(32),
  LIVEKIT_TOKEN_TTL_SECONDS: '300',
  LIVEKIT_REVOCATION_CONTRACT_VERSION: 'v1',
  LEGAL_DOCUMENT_VERSION: '2026-07-29',
  LIVEKIT_SECURITY_WORKER_HOST: '0.0.0.0',
  LIVEKIT_SECURITY_WORKER_PORT: '4010',
};

const listen = async (server: ReturnType<typeof createLivekitSecurityHttpServer>) => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

const close = (server: ReturnType<typeof createLivekitSecurityHttpServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });

const makeRuntime = (listRooms: jest.Mock) => {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        outbox_table: true,
        effect_column: true,
        participant_table: true,
        admission_column: true,
        recording_table: true,
      },
    ]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  const provider = {
    listRooms,
    removeParticipant: jest.fn(),
    updateParticipant: jest.fn(),
    deleteRoom: jest.fn(),
  };
  const runtime = new LivekitSecurityRuntime(
    parseLivekitSecurityWorkerEnv(minimalEnv),
    prisma as never,
    provider,
    { receive: jest.fn() } as never,
    { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } as never,
  );
  return { runtime, prisma };
};

describe('independent LiveKit security worker', () => {
  it('validates only its minimal security environment', () => {
    const parsed = parseLivekitSecurityWorkerEnv(minimalEnv);

    expect(parsed).toMatchObject({
      DATABASE_URL: minimalEnv.DATABASE_URL,
      LIVEKIT_API_KEY: minimalEnv.LIVEKIT_API_KEY,
      LIVEKIT_REVOCATION_CONTRACT_VERSION: 'v1',
      LIVEKIT_SECURITY_WORKER_PORT: 4010,
    });
    expect(parsed).not.toHaveProperty('REDIS_URL');
    expect(parsed).not.toHaveProperty('FIREBASE_SERVICE_ACCOUNT');
    expect(parsed).not.toHaveProperty('TWILIO_ACCOUNT_SID');
  });

  it('fails closed for a wrong image/runtime contract', () => {
    expect(() =>
      parseLivekitSecurityWorkerEnv({
        ...minimalEnv,
        LIVEKIT_REVOCATION_CONTRACT_VERSION: 'legacy',
      }),
    ).toThrow();
  });

  it('has no transitive application runtime imports in its entrypoint', () => {
    const source = readFileSync(require.resolve('../src/workers/livekitSecurity.worker'), 'utf8');
    for (const forbidden of [
      '../config/env',
      '../config/database',
      '../config/logger',
      '../app',
      'ioredis',
      'bullmq',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("column_name = 'admissionConfirmedAt'");
  });

  it('accepts only structured provider not-found codes as idempotent success', () => {
    expect(isLivekitAlreadyAbsent({ code: 'NOT_FOUND' })).toBe(true);
    expect(isLivekitAlreadyAbsent({ code: 'notfound' })).toBe(true);
    expect(isLivekitAlreadyAbsent({ code: 5 })).toBe(true);
    expect(isLivekitAlreadyAbsent({ status: 404, code: 'not_found' })).toBe(true);
    expect(isLivekitAlreadyAbsent(new Error('participant not found'))).toBe(false);
    expect(isLivekitAlreadyAbsent(new Error('route not found'))).toBe(false);
    expect(isLivekitAlreadyAbsent({ status: 404 })).toBe(false);
    expect(isLivekitAlreadyAbsent({ statusCode: 404 })).toBe(false);
    expect(isLivekitAlreadyAbsent({ response: { status: 404 } })).toBe(false);
    expect(isLivekitAlreadyAbsent(new Error('provider unavailable'))).toBe(false);
  });

  it('authenticates against a bounded provider read before readiness', async () => {
    const listRooms = jest.fn().mockResolvedValue([]);
    const { runtime } = makeRuntime(listRooms);

    await runtime.preflight();

    expect(listRooms).toHaveBeenCalledTimes(1);
    expect(listRooms).toHaveBeenCalledWith(['__chathouse_security_worker_health__']);
  });

  it.each([
    Object.assign(new Error('unauthorized'), { status: 401 }),
    Object.assign(new Error('route not found'), { status: 404 }),
  ])('fails provider preflight for endpoint/authentication errors', async providerError => {
    const { runtime } = makeRuntime(jest.fn().mockRejectedValue(providerError));
    await expect(runtime.preflight()).rejects.toBe(providerError);
  });

  it('fails health once the authenticated provider probe is stale', () => {
    const now = Date.now();
    expect(
      isLivekitSecurityHealthReady(
        {
          ready: true,
          lastSuccessfulPollAt: now,
          lastSuccessfulProviderProbeAt: now,
        },
        now,
      ),
    ).toBe(true);
    expect(
      isLivekitSecurityHealthReady(
        {
          ready: true,
          lastSuccessfulPollAt: now,
          lastSuccessfulProviderProbeAt: now - LIVEKIT_PROVIDER_PROBE_STALE_MS - 1,
        },
        now,
      ),
    ).toBe(false);
  });

  it('keeps failed periodic probes stale and refreshes health only after provider success', async () => {
    const timestamp = 123_456;
    const health = {
      ready: true,
      lastSuccessfulPollAt: timestamp,
      lastSuccessfulProviderProbeAt: 10,
    };
    const probeProvider = jest
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce(undefined);
    const logger = { error: jest.fn() };

    await expect(
      refreshLivekitProviderHealth({ probeProvider }, health, logger, () => timestamp),
    ).resolves.toBe(false);
    expect(health.lastSuccessfulProviderProbeAt).toBe(10);
    expect(logger.error).toHaveBeenCalledTimes(1);

    await expect(
      refreshLivekitProviderHealth({ probeProvider }, health, logger, () => timestamp),
    ).resolves.toBe(true);
    expect(health.lastSuccessfulProviderProbeAt).toBe(timestamp);
  });

  it('serves health and preserves the raw signed webhook contract', async () => {
    const handleWebhook = jest.fn().mockResolvedValue(undefined);
    const logger = { warn: jest.fn(), error: jest.fn() };
    const server = createLivekitSecurityHttpServer(
      { handleWebhook },
      {
        ready: true,
        lastSuccessfulPollAt: Date.now(),
        lastSuccessfulProviderProbeAt: Date.now(),
      },
      logger,
    );
    const baseUrl = await listen(server);

    try {
      const health = await fetch(`${baseUrl}/health/live`);
      expect(health.status).toBe(200);

      const webhook = await fetch(`${baseUrl}/webhooks/livekit`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer signed-token',
          'Content-Type': 'application/webhook+json',
        },
        body: '{"event":"participant_joined"}',
      });
      expect(webhook.status).toBe(200);
      expect(handleWebhook).toHaveBeenCalledWith(
        '{"event":"participant_joined"}',
        'Bearer signed-token',
      );
    } finally {
      await close(server);
    }
  });

  it('returns 401 only for signature failures and 503 for processing failures', async () => {
    const handleWebhook = jest
      .fn()
      .mockRejectedValueOnce(new LivekitWebhookAuthenticationError(new Error('bad signature')))
      .mockRejectedValueOnce(new Error('database unavailable'));
    const logger = { warn: jest.fn(), error: jest.fn() };
    const server = createLivekitSecurityHttpServer(
      { handleWebhook },
      {
        ready: true,
        lastSuccessfulPollAt: Date.now(),
        lastSuccessfulProviderProbeAt: Date.now(),
      },
      logger,
    );
    const baseUrl = await listen(server);

    try {
      const unauthorized = await fetch(`${baseUrl}/webhooks/livekit`, {
        method: 'POST',
        body: '{}',
      });
      expect(unauthorized.status).toBe(401);

      const unavailable = await fetch(`${baseUrl}/webhooks/livekit`, {
        method: 'POST',
        body: '{}',
      });
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get('retry-after')).toBe('1');
    } finally {
      await close(server);
    }
  });
});
