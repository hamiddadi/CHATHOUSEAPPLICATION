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

const mergedConfig = mergeConfig(defaultConfig, config);

// Optional native modules that may not be installed (e.g. `expo-contacts` is
// only needed for the contacts-sync extension). Resolve them to an empty module
// when absent so the bundle still builds; the call sites `require()` them inside
// a guard and treat a stub as "unavailable". This replaces the old runtime
// `import('expo-contacts')` which broke the release Hermes compile (hermesc
// rejects dynamic `import()` — "Invalid expression encountered").
const OPTIONAL_NATIVE_MODULES = ['expo-contacts', 'expo-device'];
const defaultResolveRequest = mergedConfig.resolver.resolveRequest;
mergedConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (OPTIONAL_NATIVE_MODULES.includes(moduleName)) {
    try {
      const resolver = defaultResolveRequest ?? context.resolveRequest;
      return resolver(context, moduleName, platform);
    } catch {
      return { type: 'empty' };
    }
  }
  const resolver = defaultResolveRequest ?? context.resolveRequest;
  return resolver(context, moduleName, platform);
};

module.exports = withNativeWind(mergedConfig, { input: './global.css' });
