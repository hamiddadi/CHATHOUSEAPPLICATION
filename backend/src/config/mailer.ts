import { logger } from './logger';

/**
 * Mailer stub. In dev + test we just log — swap in Nodemailer + SendGrid
 * (or Postmark / AWS SES) later. Keep the signature narrow so the callers
 * don't need to know about transport specifics.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const sendMail = async (mail: Mail): Promise<void> => {
  logger.info(`[mail-stub] → ${mail.to} :: ${mail.subject}`, { preview: mail.text.slice(0, 120) });
};
