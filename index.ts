import 'react-native-gesture-handler';
import messaging from '@react-native-firebase/messaging';
import { AppRegistry } from 'react-native';
import { App } from './App';

// FCM background / quit-state handler. `notification`-type payloads are rendered
// by the OS automatically; registering this satisfies @react-native-firebase's
// requirement that a background handler exists so data-only messages don't warn
// or get dropped. Must be set at module top level (before AppRegistry).
messaging().setBackgroundMessageHandler(async () => {
  // No-op: the server sends `notification` payloads which the system tray
  // displays without app code. Extend here for data-only background work.
});

AppRegistry.registerComponent('main', () => App);
