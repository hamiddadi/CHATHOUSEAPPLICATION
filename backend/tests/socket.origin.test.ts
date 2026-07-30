import { isSocketOriginAllowed } from '../src/socket/socket.origin';

const policy = {
  corsOrigins: ['https://app.chathouse.com'],
  publicUrl: 'https://api.chathouse.app/api',
  nodeEnv: 'production' as const,
};

describe('Socket.IO origin policy', () => {
  it('allows native clients without an Origin header', () => {
    expect(isSocketOriginAllowed(undefined, policy)).toBe(true);
  });

  it('allows the configured web app and canonical API origins', () => {
    expect(isSocketOriginAllowed('https://app.chathouse.com', policy)).toBe(true);
    expect(isSocketOriginAllowed('https://api.chathouse.app', policy)).toBe(true);
  });

  it('rejects arbitrary and malformed production origins', () => {
    expect(isSocketOriginAllowed('https://evil.example', policy)).toBe(false);
    expect(isSocketOriginAllowed('not a URL', policy)).toBe(false);
  });

  it.each([
    'http://127.0.0.1:4000',
    'http://localhost:4000',
    'http://10.47.2.110:4000',
    'http://172.20.0.1:4000',
    'http://192.168.137.1:4000',
  ])('allows the private native API origin in development: %s', origin => {
    expect(
      isSocketOriginAllowed(origin, {
        corsOrigins: ['http://localhost:8081'],
        publicUrl: 'http://localhost:4000',
        nodeEnv: 'development',
      }),
    ).toBe(true);
  });

  it('does not allow a private API origin in production unless explicitly configured', () => {
    expect(isSocketOriginAllowed('http://127.0.0.1:4000', policy)).toBe(false);
  });
});
