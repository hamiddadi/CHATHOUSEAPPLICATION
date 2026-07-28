import { assertProductionEnvironment, normalizeOptionalEnvUrl } from './env';

const production = {
  API_BASE_URL: 'https://api.chathouse.app/api',
  WS_BASE_URL: 'wss://api.chathouse.app',
  LIVEKIT_URL: 'wss://audio.chathouse.app',
  REALTIME_ENABLED: true,
  ENV: 'production' as const,
};

describe('production mobile environment guard', () => {
  it('treats an empty optional Sentry DSN as disabled', () => {
    expect(normalizeOptionalEnvUrl('')).toBeUndefined();
    expect(normalizeOptionalEnvUrl('   ')).toBeUndefined();
    expect(normalizeOptionalEnvUrl('https://sentry.example/1')).toBe('https://sentry.example/1');
  });

  it('accepts complete public TLS endpoints', () => {
    expect(() => assertProductionEnvironment(production)).not.toThrow();
  });

  it('requires realtime and LiveKit in production', () => {
    expect(() => assertProductionEnvironment({ ...production, REALTIME_ENABLED: false })).toThrow(
      'REALTIME_ENABLED=true',
    );
    expect(() => assertProductionEnvironment({ ...production, LIVEKIT_URL: undefined })).toThrow(
      'LIVEKIT_URL',
    );
  });

  it.each([
    ['API_BASE_URL', { API_BASE_URL: 'http://api.chathouse.app/api' }],
    ['WS_BASE_URL', { WS_BASE_URL: 'ws://api.chathouse.app' }],
    ['LIVEKIT_URL', { LIVEKIT_URL: 'https://audio.chathouse.app' }],
    ['API_BASE_URL', { API_BASE_URL: 'https://10.1.2.3/api' }],
    ['WS_BASE_URL', { WS_BASE_URL: 'wss://172.31.2.3' }],
    ['LIVEKIT_URL', { LIVEKIT_URL: 'wss://192.168.1.10' }],
    ['API_BASE_URL', { API_BASE_URL: 'https://169.254.10.20/api' }],
    ['WS_BASE_URL', { WS_BASE_URL: 'wss://127.0.0.1' }],
    ['LIVEKIT_URL', { LIVEKIT_URL: 'wss://[::1]' }],
    ['LIVEKIT_URL', { LIVEKIT_URL: 'wss://[fc00::1]:443' }],
    ['LIVEKIT_URL', { LIVEKIT_URL: 'wss://[fe80::1]:443' }],
    ['API_BASE_URL', { API_BASE_URL: 'https://999.999.999.999/api' }],
    ['WS_BASE_URL', { WS_BASE_URL: 'wss://api.chathouse.app:99999' }],
    ['WS_BASE_URL', { WS_BASE_URL: 'wss://api.chathouse.app:not-a-port' }],
    ['API_BASE_URL', { API_BASE_URL: 'https://api.example.test/api' }],
    ['LIVEKIT_URL', { LIVEKIT_URL: 'wss://your-project.livekit.cloud' }],
    ['API_BASE_URL', { API_BASE_URL: 'https://internal/api' }],
  ])('rejects unsafe %s values', (_label, patch) => {
    expect(() => assertProductionEnvironment({ ...production, ...patch })).toThrow();
  });

  it('does not impose production endpoints on development builds', () => {
    expect(() =>
      assertProductionEnvironment({
        API_BASE_URL: 'http://localhost:4000/api',
        WS_BASE_URL: 'ws://localhost:4000',
        LIVEKIT_URL: 'ws://localhost:7880',
        REALTIME_ENABLED: false,
        ENV: 'development',
      }),
    ).not.toThrow();
  });
});
