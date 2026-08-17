import { env } from './env';
import { logger } from './logger';

/**
 * SMS sender. Production configuration is validated at process boot in
 * env.ts, and this module also fails closed if the Twilio client cannot be
 * initialized. Development/test retain the explicit local stub.
 */
interface SmsPayload {
  to: string;
  body: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type TwilioClient = {
  messages: { create: (opts: { to: string; from: string; body: string }) => Promise<unknown> };
};

let client: TwilioClient | null = null;
let attempted = false;

const loadClient = (): TwilioClient | null => {
  if (attempted) return client;
  attempted = true;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) return null;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const twilio = require('twilio') as (sid: string, token: string) => TwilioClient;
    /* eslint-enable @typescript-eslint/no-require-imports */
    client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    return client;
  } catch {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMS provider client initialization failed');
    }
    return null;
  }
};

export const sendSms = async (
  payload: SmsPayload,
  extraDevInfo?: Record<string, string>,
): Promise<void> => {
  const c = loadClient();
  if (!c) {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMS delivery is not configured');
    }
    // Dev/test path: log the body so manual verification works without SMS.
    logger.info(`[sms-stub] → ${payload.to} :: ${payload.body}`, extraDevInfo);
    return;
  }

  const from = env.TWILIO_FROM_NUMBER;
  if (!from) {
    // Defense in depth: loadClient already requires it, and env.ts requires it
    // at production boot, but never hand an empty sender to Twilio.
    throw new Error('SMS sender number is not configured');
  }

  try {
    await c.messages.create({
      to: payload.to,
      from,
      body: payload.body,
    });
  } catch (error) {
    // Twilio RestException messages can echo request data such as the
    // destination number. Keep only non-sensitive numeric diagnostics and
    // propagate a generic error so middleware/Sentry never receive that PII.
    const providerCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'number'
        ? error.code
        : undefined;
    const providerStatus =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : undefined;
    logger.warn('[sms] provider request failed', {
      ...(providerCode !== undefined ? { providerCode } : {}),
      ...(providerStatus !== undefined ? { providerStatus } : {}),
    });
    throw new Error('SMS provider request failed');
  }
};
/* eslint-enable @typescript-eslint/no-explicit-any */
