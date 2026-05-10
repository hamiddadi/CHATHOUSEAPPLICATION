const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Disable strict package.json `exports` resolution. Some native deps (notably
// `react-native-webrtc`'s nested `event-target-shim`) declare an `exports`
// field that omits subpaths their internal code still imports — Metro's
// strict mode warns on every bundle and falls back anyway. Turning this off
// silences the noise and keeps the legacy resolution that Expo SDK <= 52
// used. Re-enable once upstream packages catch up.
config.resolver.unstable_enablePackageExports = false;

module.exports = withNativeWind(config, { input: './global.css' });
