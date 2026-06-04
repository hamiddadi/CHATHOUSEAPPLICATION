import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { RegisterPushInput } from './push.schema';

/**
 * Push-token registry + dispatcher. Wraps Expo's push API — Expo
 * proxies FCM (Android) and APNs (iOS) transparently, so one HTTP
 * call covers both platforms. The dispatcher is best-effort: a single
 * dead token must not break the notification path, and the write to
 * the Notification table already happened by the time we're here.
 *
 * Behaviour per env:
 *   - PUSH_DISPATCH_ENABLED=false (default dev): log the payload, no HTTP.
 *   - PUSH_DISPATCH_ENABLED=true:               POST to EXPO_PUSH_URL.
 */

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// Expo caps batches at 100 messages per request. We'll fan out per
// user (small N in practice) but keep the constant explicit so the
// code is correct if we ever batch across recipients.
const EXPO_BATCH_SIZE = 100;

// Error codes in an Expo ticket that indicate the token is dead and
// should be pruned. See https://docs.expo.dev/push-notifications/sending-notifications/#individual-errors
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials']);

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  priority?: 'default' | 'normal' | 'high';
}

export const pushService = {
  async register(userId: string, input: RegisterPushInput) {
    // A token's unique key is the token string itself, so registering a
    // token currently owned by another account silently reassigns it. That
    // is the intended behaviour for "same device, new login", but it also
    // lets anyone who observes a valid Expo token hijack the device's push
    // stream. Probability is low (tokens are long & opaque) but we trace
    // every reassignment so it's auditable after the fact.
    // TODO(audit): gate reassignment behind a device proof-of-possession
    //   before treating an observed token as authoritative for a new user.
    const existing = await prisma.pushToken.findUnique({
      where: { token: input.token },
      select: { userId: true },
    });
    if (existing && existing.userId !== userId) {
      logger.info('push: token reassigned', { from: existing.userId, to: userId });
    }

    await prisma.pushToken.upsert({
      where: { token: input.token },
      create: { userId, token: input.token, platform: input.platform },
      update: { userId, platform: input.platform, lastUsed: new Date() },
    });
    return { registered: true as const };
  },

  async unregister(userId: string, token: string) {
    await prisma.pushToken.deleteMany({ where: { userId, token } });
    return { unregistered: true as const };
  },

  /**
   * Fan-out to every device the user has registered. Awaits nothing
   * critical — the caller (notificationsService.create) voids the
   * returned promise.
   */
  async dispatchToUser(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await prisma.pushToken.findMany({ where: { userId } });
    if (tokens.length === 0) return;

    const messages: ExpoMessage[] = tokens.map(t => ({
      to: t.token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: 'default',
      priority: 'high',
    }));

    if (!env.PUSH_DISPATCH_ENABLED) {
      for (const msg of messages) {
        logger.info('[push/stub] would send', {
          token: msg.to.slice(0, 10) + '…',
          title: msg.title,
          body: msg.body,
          data: msg.data,
        });
      }
      return;
    }

    // Chunk + fire. `sendBatch` swallows its own errors so one failing
    // batch doesn't suppress later ones.
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      await sendBatch(batch);
    }
  },
};

/**
 * POST a batch of ExpoMessage objects to Expo's push endpoint, parse
 * the tickets array, and prune any tokens Expo flagged as dead.
 */
const sendBatch = async (messages: ExpoMessage[]): Promise<void> => {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (env.EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
    }

    const response = await fetch(env.EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      logger.warn('push: non-2xx from Expo', {
        status: response.status,
        count: messages.length,
      });
      return;
    }

    const payload = (await response.json()) as { data?: ExpoTicket[] };
    const tickets = payload.data ?? [];
    const deadTokens: string[] = [];
    tickets.forEach((ticket, idx) => {
      if (ticket.status === 'error') {
        const msg = messages[idx];
        const code = ticket.details?.error;
        logger.warn('push: ticket error', {
          token: msg?.to.slice(0, 10) + '…',
          code,
          message: ticket.message,
        });
        if (msg && code && DEAD_TOKEN_ERRORS.has(code)) {
          deadTokens.push(msg.to);
        }
      }
    });

    if (deadTokens.length > 0) {
      const pruned = await prisma.pushToken.deleteMany({
        where: { token: { in: deadTokens } },
      });
      logger.info(`push: pruned ${pruned.count} dead token(s)`);
    }
  } catch (err) {
    // Network errors, DNS, TLS — never bubble. Push is a best-effort
    // enhancement to the DB row that already landed.
    logger.warn('push: dispatch failed', {
      err: err instanceof Error ? err.message : String(err),
      count: messages.length,
    });
  }
};
