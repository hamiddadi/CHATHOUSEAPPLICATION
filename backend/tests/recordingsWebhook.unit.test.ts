import express from 'express';
import request from 'supertest';

const mockHandleWebhook = jest.fn<Promise<void>, [string, string | undefined]>();

jest.mock('../src/modules/recordings/recordings.service', () => {
  class LivekitWebhookAuthenticationError extends Error {}
  return {
    LivekitWebhookAuthenticationError,
    recordingsService: {
      handleWebhook: (body: string, authorization: string | undefined) =>
        mockHandleWebhook(body, authorization),
    },
  };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { LivekitWebhookAuthenticationError } =
  require('../src/modules/recordings/recordings.service') as typeof import('../src/modules/recordings/recordings.service');
const { livekitWebhookRouter } =
  require('../src/modules/recordings/recordings.webhook') as typeof import('../src/modules/recordings/recordings.webhook');
/* eslint-enable @typescript-eslint/no-require-imports */

const app = express();
app.use('/webhooks', livekitWebhookRouter);

describe('LiveKit webhook HTTP retry contract', () => {
  beforeEach(() => mockHandleWebhook.mockReset());

  it('returns 401 only for authentication failures', async () => {
    mockHandleWebhook.mockRejectedValueOnce(
      new LivekitWebhookAuthenticationError(new Error('bad')),
    );
    const response = await request(app)
      .post('/webhooks/livekit')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'invalid')
      .send('{"event":"participant_joined"}');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ ok: false });
  });

  it('returns retryable 503 for provider or database processing failures', async () => {
    mockHandleWebhook.mockRejectedValueOnce(new Error('provider unavailable'));
    const response = await request(app)
      .post('/webhooks/livekit')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'signed')
      .send('{"event":"participant_joined"}');

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toEqual({ ok: false });
  });

  it('acknowledges only after verified processing succeeds', async () => {
    mockHandleWebhook.mockResolvedValueOnce(undefined);
    const response = await request(app)
      .post('/webhooks/livekit')
      .set('Content-Type', 'application/json')
      .set('Authorization', 'signed')
      .send('{"event":"participant_joined"}');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mockHandleWebhook).toHaveBeenCalledWith('{"event":"participant_joined"}', 'signed');
  });
});

export {};
