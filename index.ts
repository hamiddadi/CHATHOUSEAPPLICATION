import 'react-native-gesture-handler';
import notifee from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { AppRegistry } from 'react-native';
import { App } from './App';
import { handleBackgroundNotificationEvent } from './src/features/notifications/services/notificationOpenService';

// FCM background / quit-state handler. `notification`-type payloads are rendered
// by the OS automatically; registering this satisfies @react-native-firebase's
// requirement that a background handler exists so data-only messages don't warn
// or get dropped. Must be set at module top level (before AppRegistry).
messaging().setBackgroundMessageHandler(async () => {
  // No-op: the server sends `notification` payloads which the system tray
  // displays without app code. Extend here for data-only background work.
});

// Notifee owns press delivery for notifications it rendered/intercepted. This
// top-level handler is required for background events; it forwards the tap to
// the same canonical deep-link pipeline used by FCM and foreground presses.
notifee.onBackgroundEvent(handleBackgroundNotificationEvent);

AppRegistry.registerComponent('main', () => App);
