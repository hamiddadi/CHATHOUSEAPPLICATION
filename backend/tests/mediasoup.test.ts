/**
 * Mediasoup server-side smoke test. Verifies:
 *  - the worker pool spins up
 *  - a router is created per room with the Opus codec we configured
 *  - a WebRTC transport can be created and returns valid ICE/DTLS params
 *
 * Skipped automatically when the `mediasoup` package isn't installed (Windows
 * dev hosts without C++ build toolchain) OR when MEDIASOUP_ENABLED=false.
 *
 * End-to-end audio (producer/consume round-trip across actual RTP) can only
 * be validated with a real browser or a mediasoup-client headless harness —
 * out of scope for the server test suite.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
let mediasoupAvailable = true;
try {
  require.resolve('mediasoup');
} catch {
  mediasoupAvailable = false;
}

// Force-enable mediasoup for this suite even if the default env flag is off.
if (mediasoupAvailable) {
  process.env.MEDIASOUP_ENABLED = 'true';
  process.env.MEDIASOUP_RTC_MIN_PORT = process.env.MEDIASOUP_RTC_MIN_PORT ?? '40200';
  process.env.MEDIASOUP_RTC_MAX_PORT = process.env.MEDIASOUP_RTC_MAX_PORT ?? '40209';
  process.env.MEDIASOUP_NUM_WORKERS = '1';
  process.env.MEDIASOUP_LISTEN_IP = '127.0.0.1';
  process.env.MEDIASOUP_ANNOUNCED_IP = '127.0.0.1';
}

const describeOrSkip = mediasoupAvailable ? describe : describe.skip;

describeOrSkip('mediasoup manager', () => {
  const { initMediasoup, shutdownMediasoup, isReady, getRtpCapabilities, createWebRtcTransport } =
    require('../src/webrtc/mediasoup.manager') as typeof import('../src/webrtc/mediasoup.manager');

  beforeAll(async () => {
    await initMediasoup();
  }, 30_000);

  afterAll(async () => {
    await shutdownMediasoup();
  }, 30_000);

  it('spawns at least one worker and is ready', () => {
    expect(isReady()).toBe(true);
  });

  it('exposes Opus-capable RTP capabilities per router', async () => {
    const caps = (await getRtpCapabilities('room-opus-test')) as {
      codecs: { mimeType: string }[];
    };
    expect(caps.codecs.some(c => c.mimeType.toLowerCase() === 'audio/opus')).toBe(true);
  });

  it('creates a WebRTC transport with ICE + DTLS parameters', async () => {
    const transport = await createWebRtcTransport('room-transport-test');
    expect(transport.id).toEqual(expect.any(String));
    expect(transport.iceCandidates.length).toBeGreaterThan(0);
    expect(transport.dtlsParameters).toBeTruthy();
  });
});
/* eslint-enable @typescript-eslint/no-require-imports */
