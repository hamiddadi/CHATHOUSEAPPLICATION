import { env } from './env';
import { logger } from './logger';

/**
 * Password-reset mail transport.
 *
 * Development/test intentionally do not deliver external email. Production
 * uses Resend's HTTPS API through Node's built-in fetch, so there is no second
 * SMTP/HTTP dependency to install or keep patched.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const MAIL_TIMEOUT_MS = 10_000;

interface ResendSuccess {
  id: string;
}

const isResendSuccess = (value: unknown): value is ResendSuccess =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof (value as { id: unknown }).id === 'string' &&
  (value as { id: string }).id.length > 0;

export const sendMail = async (mail: Mail): Promise<void> => {
  if (env.NODE_ENV !== 'production') {
    // Never log text/html: password-reset bodies contain a live bearer token.
    logger.info('[mail-stub] external delivery skipped', {
      to: mail.to,
      subject: mail.subject,
    });
    return;
  }

  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  if (!apiKey || !from) {
    // Defense in depth for direct module use; env.ts already rejects this at
    // process boot in production.
    throw new Error('Email delivery is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Do not include the provider response body: it can echo request data.
      throw new Error(`Email provider rejected the request (HTTP ${response.status})`);
    }

    const result: unknown = await response.json();
    if (!isResendSuccess(result)) {
      throw new Error('Email provider returned an invalid success response');
    }

    logger.info('[mail] accepted by provider', { messageId: result.id });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Email provider request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
