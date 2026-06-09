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

// Optional native modules that may not be installed (e.g. `expo-contacts` is
// only needed for the contacts-sync extension). Resolve them to an empty module
// when absent so the bundle still builds; the call sites `require()` them inside
// a guard and treat a stub as "unavailable". This replaces the old runtime
// `import('expo-contacts')` which broke the release Hermes compile (hermesc
// rejects dynamic `import()` — "Invalid expression encountered").
const OPTIONAL_NATIVE_MODULES = ['expo-contacts', 'expo-device'];

// Force `livekit-client` to its ESM build. With package exports disabled
// (above), Metro otherwise resolves it via `main` → the UMD build
// (`livekit-client.umd.js`). That UMD wrapper detects its global via
// `(function (global) { … })(this)`, but under Hermes in a release bundle the
// module runs in strict mode where `this` is `undefined` → the wrapper can't
// install its internals → the inlined `events` module's `EventEmitter` ends up
// undefined → `class Room extends eventsExports.EventEmitter` throws
// "Cannot read property 'prototype' of undefined" the moment you join a room
// (audio never starts). The ESM build has no `this`-based UMD wrapper and runs
// fine under Hermes. Resolve the path lazily so a missing dep can't break boot.
// NOTE: livekit-client's `exports` map blocks deep subpaths, so `require.resolve`
// can't reach the build file. Point at it directly under node_modules instead
// (this project hoists livekit-client to the root). Guarded by existsSync so a
// move/upgrade can't break bundling.
const path = require('path');
const fs = require('fs');
const LIVEKIT_CLIENT_ESM_CANDIDATE = path.join(
  __dirname,
  'node_modules',
  'livekit-client',
  'dist',
  'livekit-client.esm.mjs',
);
const LIVEKIT_CLIENT_ESM = fs.existsSync(LIVEKIT_CLIENT_ESM_CANDIDATE)
  ? LIVEKIT_CLIENT_ESM_CANDIDATE
  : undefined;

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'livekit-client' && LIVEKIT_CLIENT_ESM) {
    return { type: 'sourceFile', filePath: LIVEKIT_CLIENT_ESM };
  }
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

module.exports = withNativeWind(config, { input: './global.css' });
