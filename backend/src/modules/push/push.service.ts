import { initializeApp, getApps, cert, type ServiceAccount } from 'firebase-admin';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../middlewares/error.middleware';
import type { RegisterPushInput } from './push.schema';

/**
 * Push-token registry + dispatcher over Firebase Cloud Messaging (de-Expo:
 * replaced Expo's hosted push proxy with firebase-admin talking to FCM
 * directly — one SDK covers Android FCM and iOS APNs). The dispatcher is
 * best-effort: a single dead token must not break the notification path, and
 * the write to the Notification table already happened by the time we're here.
 *
 * Behaviour per env:
 *   - PUSH_DISPATCH_ENABLED=false (default dev):   log the payload, no FCM call.
 *   - PUSH_DISPATCH_ENABLED=true + credentials:    send via firebase-admin.
 *   - PUSH_DISPATCH_ENABLED=true, no credentials:  warn + skip (fail-safe).
 */

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// FCM caps sendEachForMulticast at 500 tokens per call.
const FCM_BATCH_SIZE = 500;

// firebase-admin error codes that mean the token is dead and should be pruned.
// `registration-token-not-registered` = uninstalled / token rotated;
// `invalid-argument` also catches legacy Expo tokens (ExponentPushToken[…])
// left in the table from before the FCM migration. See
// https://firebase.google.com/docs/cloud-messaging/manage-tokens
const DEAD_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

// Lazily-initialised messaging client. `undefined` = not yet attempted,
// `null` = init failed / no credentials (don't retry on every dispatch).
let messagingClient: Messaging | null | undefined;

const getMessagingClient = (): Messaging | null => {
  if (messagingClient !== undefined) return messagingClient;
  try {
    if (getApps().length === 0) {
      if (env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
        initializeApp({ credential: cert(serviceAccount) });
      } else {
        // Falls back to GOOGLE_APPLICATION_CREDENTIALS / Application Default
        // Credentials when the inline JSON isn't provided.
        initializeApp();
      }
    }
    messagingClient = getMessaging();
  } catch (err) {
    logger.error('push: firebase-admin init failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    messagingClient = null;
  }
  return messagingClient;
};

// FCM data values must be strings — stringify any non-string entries.
const stringifyData = (data?: Record<string, unknown>): Record<string, string> | undefined => {
  if (!data) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
};

export const pushService = {
  async register(userId: string, input: RegisterPushInput) {
    // Serialize claims for the same opaque FCM token. A token observed in logs
    // or on another device must never be enough to redirect a victim's push
    // stream to a different account. The mobile client resolves a legitimate
    // shared-device switch by invalidating its local FCM token and registering
    // the freshly rotated replacement.
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${input.token}, 0))::text
      `;
      const existing = await tx.pushToken.findUnique({
        where: { token: input.token },
        select: { userId: true },
      });
      if (existing && existing.userId !== userId) {
        logger.warn('push: rejected cross-account token claim', {
          currentOwnerId: existing.userId,
          claimantId: userId,
        });
        throw new AppError('PUSH_001');
      }
      if (existing) {
        await tx.pushToken.update({
          where: { token: input.token },
          data: { platform: input.platform, lastUsed: new Date() },
        });
        return;
      }
      await tx.pushToken.create({
        data: { userId, token: input.token, platform: input.platform },
      });
    });
    return { registered: true as const };
  },

  async unregister(userId: string, token: string) {
    await prisma.pushToken.deleteMany({ where: { userId, token } });
    return { unregistered: true as const };
  },

  /**
   * Fan-out to every device the user has registered. Awaits nothing critical —
   * the caller (notificationsService.create) voids the returned promise.
   */
  async dispatchToUser(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await prisma.pushToken.findMany({ where: { userId } });
    if (tokens.length === 0) return;
    const tokenStrings = tokens.map(t => t.token);

    if (!env.PUSH_DISPATCH_ENABLED) {
      for (const token of tokenStrings) {
        logger.info('[push/stub] would send', {
          token: token.slice(0, 10) + '…',
          title: payload.title,
          body: payload.body,
          data: payload.data,
        });
      }
      return;
    }

    const messaging = getMessagingClient();
    if (!messaging) {
      logger.warn('push: dispatch enabled but firebase-admin is not configured', { userId });
      return;
    }

    const data = stringifyData(payload.data);
    // Chunk + fire. `sendBatch` swallows its own errors so one failing batch
    // doesn't suppress later ones.
    for (let i = 0; i < tokenStrings.length; i += FCM_BATCH_SIZE) {
      const batch = tokenStrings.slice(i, i + FCM_BATCH_SIZE);
      await sendBatch(messaging, batch, payload, data);
    }
  },
};

/**
 * Send one batch of up to 500 tokens via firebase-admin, then prune any tokens
 * FCM flagged as dead.
 */
const sendBatch = async (
  messaging: Messaging,
  tokens: string[],
  payload: PushPayload,
  data: Record<string, string> | undefined,
): Promise<void> => {
  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data,
      android: { priority: 'high', notification: { sound: 'default' } },
    });

    if (response.failureCount === 0) return;

    const deadTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (res.success) return;
      const token = tokens[idx];
      const code = res.error?.code;
      logger.warn('push: send error', {
        token: token ? token.slice(0, 10) + '…' : undefined,
        code,
        message: res.error?.message,
      });
      if (token && code && DEAD_TOKEN_ERRORS.has(code)) {
        deadTokens.push(token);
      }
    });

    if (deadTokens.length > 0) {
      const pruned = await prisma.pushToken.deleteMany({
        where: { token: { in: deadTokens } },
      });
      logger.info(`push: pruned ${pruned.count} dead token(s)`);
    }
  } catch (err) {
    // Network errors, credential errors, etc. — never bubble. Push is a
    // best-effort enhancement to the DB row that already landed.
    logger.warn('push: dispatch failed', {
      err: err instanceof Error ? err.message : String(err),
      count: tokens.length,
    });
  }
};
