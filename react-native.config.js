/**
 * React Native CLI autolinking configuration.
 *
 * This is a bare React Native app (NO Expo). However, `expo` and a few
 * `expo-*` packages get pulled into node_modules as OPTIONAL peer deps of
 * @react-native-firebase/* and @sentry/react-native.
 *
 * `node_modules/expo/react-native.config.js` normally disables its own
 * native autolinking for bare projects, but that check relies on
 * `findProjectRootSync()` locating `android/settings.gradle`. When the
 * project lives in a path with spaces (e.g. "ChatHouse-source 2") or is built
 * from an unexpected cwd, that detection fails, expo defaults to "managed app"
 * and gets autolinked — producing the Gradle error:
 *   > Plugin with id 'expo-module-gradle-plugin' not found.
 *   > project ':expo' does not specify compileSdk
 *
 * We deterministically exclude every Expo package that ships an android/ios
 * native project from autolinking. The app uses none of them at runtime.
 */
const EXCLUDED = ['expo', 'expo-asset', 'expo-constants', 'expo-font', 'expo-modules-core'];

module.exports = {
  dependencies: EXCLUDED.reduce((acc, name) => {
    acc[name] = { platforms: { android: null, ios: null } };
    return acc;
  }, {}),
};
