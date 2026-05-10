import { env } from './env';
import { logger } from './logger';

/**
 * SMS sender. Lazy-loads `twilio` when TWILIO_* env vars are set so the
 * backend boots without requiring the package. In dev (or when creds are
 * missing) we log the raw code — very helpful for manual testing against
 * Expo Go without a real phone.
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
    return null;
  }
};

export const sendSms = async (
  payload: SmsPayload,
  extraDevInfo?: Record<string, string>,
): Promise<void> => {
  const c = loadClient();
  if (!c) {
    // Dev/test path: log the body so manual verification works without SMS.
    logger.info(`[sms-stub] → ${payload.to} :: ${payload.body}`, extraDevInfo);
    return;
  }
  await c.messages.create({
    to: payload.to,
    from: env.TWILIO_FROM_NUMBER ?? '',
    body: payload.body,
  });
};
/* eslint-enable @typescript-eslint/no-explicit-any */
