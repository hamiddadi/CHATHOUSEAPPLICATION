import notifee, { AndroidImportance } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';

/**
 * Foreground notification display (de-Expo: replaces expo-notifications'
 * `setNotificationHandler`). FCM hands `notification` payloads to the system
 * tray automatically when the app is backgrounded, but foreground messages
 * arrive silently — we surface them with notifee on a dedicated channel.
 */

export const ANDROID_CHANNEL_ID = 'default';

// Android 8+ requires a channel before a notification can show. Created once
// and memoised; notifee.createChannel is idempotent on the same id.
let channelReady: Promise<string> | null = null;

const ensureChannel = (): Promise<string> => {
  channelReady ??= notifee.createChannel({
    id: ANDROID_CHANNEL_ID,
    name: 'General',
    importance: AndroidImportance.HIGH,
  });
  return channelReady;
};

/**
 * Subscribe to foreground FCM messages and render them via notifee. Returns the
 * unsubscribe fn (call on unmount). Safe to invoke once at app start.
 */
export const setupForegroundPush = (): (() => void) => {
  void ensureChannel();
  return messaging().onMessage(async remoteMessage => {
    const channelId = await ensureChannel();
    const { notification, data } = remoteMessage;
    await notifee.displayNotification({
      title: notification?.title,
      body: notification?.body,
      data,
      android: { channelId, pressAction: { id: 'default' } },
    });
  });
};
