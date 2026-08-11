import notifee, { EventType, type Event } from '@notifee/react-native';
import {
  getInitialNotification,
  getMessaging,
  onNotificationOpenedApp,
} from '@react-native-firebase/messaging';

type NotificationData = Record<string, unknown> | undefined;
type DeepLinkListener = (url: string) => void;

const NOTIFICATIONS_DEEP_LINK = 'chathouse://notifications';
const DUPLICATE_WINDOW_MS = 2_000;
const listeners = new Set<DeepLinkListener>();
const firebaseMessaging = getMessaging();

let pendingDeepLink: string | null = null;
let lastOpen: { key: string; at: number } | null = null;

const asIdentifier = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;

const pathSegment = (value: string): string => encodeURIComponent(value);

/**
 * Convert the data contract emitted by the backend notification service into
 * one of the canonical paths declared in core/navigation/linking.ts.
 *
 * Unknown or incomplete payloads deliberately open the in-app notification
 * list: a tray tap must never navigate with an untrusted/missing identifier.
 */
export const notificationDataToDeepLink = (data: NotificationData): string => {
  const type = asIdentifier(data?.type);
  const kind = asIdentifier(data?.kind);
  const roomId = asIdentifier(data?.roomId);
  const clubId = asIdentifier(data?.clubId);
  const conversationId = asIdentifier(data?.conversationId);
  const senderId = asIdentifier(data?.senderId);

  if (type === 'NEW_MESSAGE') {
    if (data?.conversation === 'group' && conversationId) {
      return `chathouse://group/${pathSegment(conversationId)}`;
    }
    if (senderId) return `chathouse://chat/${pathSegment(senderId)}`;
    return NOTIFICATIONS_DEEP_LINK;
  }

  if (type === 'CLUB_INVITE' && clubId) {
    // Reused CLUB_INVITE events for membership-request outcomes are not
    // invitations. Approved/request-admin events open the house; declined
    // requests stay on the notification list because the private house may
    // no longer be accessible.
    if (kind === 'join_approved' || kind === 'join_request') {
      return `chathouse://house/${pathSegment(clubId)}`;
    }
    if (kind === 'join_declined') return NOTIFICATIONS_DEEP_LINK;
    return `chathouse://house/${pathSegment(clubId)}/invite`;
  }

  if (roomId) {
    return `chathouse://room/${pathSegment(roomId)}`;
  }

  if (type === 'FOLLOW_REQUEST') {
    return 'chathouse://notifications/follow-requests';
  }

  if (type === 'NEW_FOLLOWER' || type === 'WAVE') {
    const userId =
      asIdentifier(data?.followerId) ??
      asIdentifier(data?.waverId) ??
      asIdentifier(data?.inviteeId) ??
      asIdentifier(data?.actorId);
    if (userId) return `chathouse://u/${pathSegment(userId)}`;
  }

  return NOTIFICATIONS_DEEP_LINK;
};

const openedNotification = (
  data: NotificationData,
): {
  url: string;
  key: string;
} => {
  const url = notificationDataToDeepLink(data);
  const notificationId = asIdentifier(data?.notificationId);
  return {
    url,
    key: notificationId ? `notification:${notificationId}` : `destination:${url}`,
  };
};

const isDuplicate = (key: string, now = Date.now()): boolean => {
  if (lastOpen?.key === key && now - lastOpen.at < DUPLICATE_WINDOW_MS) return true;
  lastOpen = { key, at: now };
  return false;
};

const publishNotificationOpen = (data: NotificationData): void => {
  const opened = openedNotification(data);
  // A remote notification may be surfaced by both RNFirebase and Notifee.
  // Treat the two callbacks as one user action.
  if (isDuplicate(opened.key)) return;

  if (listeners.size === 0) {
    pendingDeepLink = opened.url;
    return;
  }
  listeners.forEach(listener => listener(opened.url));
};

const consumePendingDeepLink = (): string | null => {
  const url = pendingDeepLink;
  pendingDeepLink = null;
  return url;
};

/**
 * Supplies React Navigation's initial URL for a notification cold start.
 * RNFirebase covers system-rendered remote notifications; Notifee is the
 * fallback for notifications it rendered/intercepted.
 */
export const getInitialNotificationDeepLink = async (): Promise<string | null> => {
  const queued = consumePendingDeepLink();
  if (queued) return queued;

  try {
    const remoteMessage = await getInitialNotification(firebaseMessaging);
    if (remoteMessage) {
      const opened = openedNotification(remoteMessage.data);
      if (!isDuplicate(opened.key)) return opened.url;
    }
  } catch {
    // A native notification lookup must not prevent normal app startup.
  }

  try {
    const initial = await notifee.getInitialNotification();
    if (initial) {
      const opened = openedNotification(initial.notification.data);
      if (!isDuplicate(opened.key)) return opened.url;
    }
  } catch {
    // Same fail-safe for a missing/unavailable Notifee native bridge.
  }

  return null;
};

/**
 * Merge notification-open callbacks into React Navigation's URL listener.
 */
export const subscribeToNotificationDeepLinks = (listener: DeepLinkListener): (() => void) => {
  listeners.add(listener);

  const unsubscribeMessaging = onNotificationOpenedApp(firebaseMessaging, remoteMessage => {
    publishNotificationOpen(remoteMessage.data);
  });
  const unsubscribeNotifee = notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) publishNotificationOpen(detail.notification?.data);
  });

  // Covers a background Notifee event that arrived just before the navigation
  // container installed its linking subscriber.
  const queued = consumePendingDeepLink();
  if (queued) listener(queued);

  return () => {
    listeners.delete(listener);
    unsubscribeMessaging();
    unsubscribeNotifee();
  };
};

/**
 * Registered once at the JS entry point for Android/iOS background Notifee
 * press delivery. If the navigation container is alive this publishes
 * immediately; during a cold start it queues the canonical deep link.
 */
export const handleBackgroundNotificationEvent = async (event: Event): Promise<void> => {
  if (event.type === EventType.PRESS) {
    publishNotificationOpen(event.detail.notification?.data);
  }
};

/** Test-only reset for module-level deduplication/pending state. */
export const resetNotificationOpenStateForTests = (): void => {
  pendingDeepLink = null;
  lastOpen = null;
  listeners.clear();
};
