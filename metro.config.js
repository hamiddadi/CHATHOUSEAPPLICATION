const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('@react-native/metro-config').MetroConfig} */
const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // Disable strict package.json `exports` resolution. Some native deps (notably
    // `react-native-webrtc`'s nested `event-target-shim`) declare an `exports`
    // field that omits subpaths their internal code still imports — Metro's
    // strict mode warns on every bundle and falls back anyway. Turning this off
    // silences the noise and keeps the legacy resolution that previous SDKs used.
    unstable_enablePackageExports: false,
  },
};

module.exports = withNativeWind(mergeConfig(defaultConfig, config), { input: './global.css' });
