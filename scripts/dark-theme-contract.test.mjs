import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const readProjectFile = relativePath => readFileSync(resolve(projectRoot, relativePath), 'utf8');

const getStyle = (xml, styleName) => {
  const escapedName = styleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<style\\s+name="${escapedName}"[^>]*>[\\s\\S]*?</style>`));
  assert.ok(match, `Missing Android style: ${styleName}`);
  return match[0];
};

const assertDarkSystemBars = (style, source) => {
  assert.match(
    style,
    /<item name="android:windowLightStatusBar">false<\/item>/,
    `${source} must use light status-bar icons`,
  );
  assert.match(
    style,
    /<item name="android:windowLightNavigationBar">false<\/item>/,
    `${source} must use light navigation-bar icons`,
  );
};

test('Expo, JavaScript, Android and iOS stay aligned to the mono-dark product theme', () => {
  const appConfig = JSON.parse(readProjectFile('app.json'));
  assert.equal(appConfig.expo?.userInterfaceStyle, 'dark');

  const themeProvider = readProjectFile('src/core/providers/ThemeProvider.tsx');
  assert.match(themeProvider, /type ThemeMode = 'dark'/);
  assert.match(themeProvider, /mode: 'dark'/);

  const rootNavigator = readProjectFile('src/core/navigation/RootNavigator.tsx');
  assert.match(rootNavigator, /const navigationTheme = \{\s*\.\.\.DarkTheme/);
  assert.match(
    rootNavigator,
    /<StatusBar barStyle="light-content" backgroundColor=\{colors\.background\} \/>/,
  );
  assert.match(rootNavigator, /contentStyle: \{ backgroundColor: colors\.background \}/);

  const androidStyles = readProjectFile('android/app/src/main/res/values/styles.xml');
  const appTheme = getStyle(androidStyles, 'AppTheme');
  assert.match(appTheme, /parent="Theme\.AppCompat\.NoActionBar"/);
  assert.doesNotMatch(appTheme, /DayNight/);
  assert.match(appTheme, /<item name="android:forceDarkAllowed">false<\/item>/);
  assertDarkSystemBars(appTheme, 'AppTheme');

  const splashTheme = getStyle(androidStyles, 'Theme.App.SplashScreen');
  assert.match(splashTheme, /<item name="postSplashScreenTheme">@style\/AppTheme<\/item>/);
  assertDarkSystemBars(splashTheme, 'Theme.App.SplashScreen');

  const android33Styles = readProjectFile('android/app/src/main/res/values-v33/styles.xml');
  const android33SplashTheme = getStyle(android33Styles, 'Theme.App.SplashScreen');
  assert.match(android33SplashTheme, /<item name="postSplashScreenTheme">@style\/AppTheme<\/item>/);
  assertDarkSystemBars(android33SplashTheme, 'Theme.App.SplashScreen (API 33+)');

  const androidColors = readProjectFile('android/app/src/main/res/values/colors.xml');
  assert.match(
    androidColors,
    /<color name="splashscreen_background">#0c112e<\/color>/,
    'Android splash must retain the product dark background',
  );

  const infoPlist = readProjectFile('ios/ChatHouse/Info.plist');
  assert.match(
    infoPlist,
    /<key>UIUserInterfaceStyle<\/key>\s*<string>Dark<\/string>/,
    'iOS must force dark native controls and presentation surfaces',
  );

  const launchScreen = readProjectFile('ios/ChatHouse/LaunchScreen.storyboard');
  assert.match(
    launchScreen,
    /<color key="backgroundColor" red="0\.04705882353" green="0\.06666666667" blue="0\.1803921569"/,
    'iOS launch screen must retain the product dark background',
  );
});

test('the NativeWind Metro integration no longer emits the Expo color-scheme warning', () => {
  const { expoColorSchemeWarning } = require('react-native-css-interop/dist/metro/expo');
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    expoColorSchemeWarning();
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(warnings, []);
});
