import {
  applicationDefault,
  initializeApp,
  getApps,
  cert,
  type ServiceAccount,
} from 'firebase-admin';
import type { Credential } from 'firebase-admin/app';
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
 * best-effort at the notification-call-site level: a single dead token must not
 * break the notification row write. Initialization and transport failures are
 * still rejected explicitly so workers and operational logs can detect them.
 *
 * Behaviour per env:
 *   - PUSH_DISPATCH_ENABLED=false (default dev):   log the payload, no FCM call.
 *   - PUSH_DISPATCH_ENABLED=true + credentials:    send via firebase-admin.
 *   - Production: dispatch + exactly one explicit credential mode are required.
 */

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// FCM caps sendEachForMulticast at 500 tokens per call.
const FCM_BATCH_SIZE = 500;
export const PUSH_CREDENTIAL_PROBE_TIMEOUT_MS = 10_000;

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

// Lazily-initialised messaging client. Production also calls initializePush()
// during server boot, before accepting traffic.
let messagingClient: Messaging | undefined;
let credentialClient: Credential | undefined;
let credentialProbePromise: Promise<void> | undefined;

type CredentialMode = 'inline_service_account' | 'adc' | 'existing_app' | 'missing';
let activeCredentialMode: CredentialMode = 'missing';

const configuredCredentialMode = (): CredentialMode => {
  if (env.FIREBASE_SERVICE_ACCOUNT) return 'inline_service_account';
  if (env.FIREBASE_USE_ADC) return 'adc';
  return 'missing';
};

const getMessagingClient = (): Messaging => {
  if (messagingClient !== undefined) return messagingClient;
  let credentialMode = configuredCredentialMode();
  try {
    const apps = getApps();
    if (apps.length === 0) {
      if (env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
        credentialClient = cert(serviceAccount);
        initializeApp({ credential: credentialClient });
      } else if (env.FIREBASE_USE_ADC) {
        credentialClient = applicationDefault();
        initializeApp({ credential: credentialClient });
      } else {
        throw new Error(
          'no Firebase credential mode configured (set FIREBASE_SERVICE_ACCOUNT or FIREBASE_USE_ADC=true)',
        );
      }
    } else {
      credentialMode = 'existing_app';
      credentialClient = apps[0]?.options?.credential;
      if (!credentialClient && env.NODE_ENV === 'production') {
        throw new Error('the existing Firebase app has no credential');
      }
    }
    activeCredentialMode = credentialMode;
    messagingClient = getMessaging();
  } catch {
    // Firebase errors may contain credential paths, service-account identities,
    // or provider response fragments. Keep logs diagnostic but secret-free.
    logger.error('push: firebase-admin init failed', {
      credentialMode,
    });
    throw new Error('Push delivery initialization failed');
  }
  return messagingClient;
};

const probeCredential = async (): Promise<void> => {
  const credential = credentialClient;
  if (!credential) {
    throw new Error('Push delivery credential is unavailable');
  }

  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    const result = await Promise.race([
      credential.getAccessToken(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(new Error('credential probe timeout'));
        }, PUSH_CREDENTIAL_PROBE_TIMEOUT_MS);
      }),
    ]);
    if (
      !result ||
      typeof result.access_token !== 'string' ||
      result.access_token.length === 0 ||
      !Number.isFinite(result.expires_in) ||
      result.expires_in <= 0
    ) {
      throw new Error('credential provider returned an invalid access token');
    }
  } catch {
    logger.error('push: Firebase credential probe failed', {
      credentialMode: activeCredentialMode,
      reason: timedOut ? 'timeout' : 'rejected',
    });
    throw new Error(
      timedOut
        ? 'Push delivery credential probe timed out'
        : 'Push delivery credential probe failed',
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/**
 * Validate and construct the Firebase messaging client before the HTTP server
 * starts. Production also requests a real OAuth access token with a bounded
 * timeout: applicationDefault() itself is lazy and would otherwise let a
 * missing workload identity fail only on the first notification.
 */
export const initializePush = async (): Promise<void> => {
  if (!env.PUSH_DISPATCH_ENABLED) {
    if (env.NODE_ENV === 'production') {
      throw new Error('Push delivery cannot be disabled in production');
    }
    return;
  }
  getMessagingClient();
  if (env.NODE_ENV === 'production') {
    credentialProbePromise ??= probeCredential();
    await credentialProbePromise;
  }
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

    const data = stringifyData(payload.data);
    // Chunk sequentially so a rejected provider call is visible to the caller.
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
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          icon: 'ic_stat_audio',
          sound: 'default',
        },
      },
    });

    if (response.failureCount === 0) return;

    const deadTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (res.success) return;
      const token = tokens[idx];
      const code = res.error?.code;
      logger.warn('push: send error', {
        batchIndex: idx,
        code,
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
    // The notification caller may keep the already-persisted in-app row, but
    // transport/authentication failures must remain observable.
    logger.error('push: dispatch failed', {
      err: err instanceof Error ? err.message : String(err),
      count: tokens.length,
    });
    throw err;
  }
};
