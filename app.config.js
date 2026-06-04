// eslint-disable-next-line @typescript-eslint/no-require-imports
const base = require('./app.json');

/**
 * Dynamic Expo config — overlays env-driven values on top of the static
 * app.json so we can inject production URLs + Sentry DSN via EAS secrets
 * (`eas secret:create --name API_BASE_URL --value ...`) without committing
 * anything sensitive to the repo.
 *
 * In dev with Expo Go, `process.env.X` falls through to the defaults below.
 * In EAS Build, EAS secrets materialise as process.env.* at build time.
 */
module.exports = ({ config: _config }) => {
  const envTag = process.env.APP_ENV ?? 'development';
  const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000/api';
  const wsBaseUrl = process.env.WS_BASE_URL ?? 'ws://localhost:4000';
  const realtimeEnabled = process.env.REALTIME_ENABLED === 'true';
  const sentryDsn = process.env.SENTRY_DSN;

  // LiveKit — URL is the WebSocket endpoint of the LiveKit server.
  // No client-side secrets needed — the backend signs JWT tokens.
  const livekitUrl = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';

  // Google Maps Android API key — required by react-native-maps to initialise
  // the native MapView on Android (even though the Map screen overlays OSM
  // tiles; the SDK must be authorised or the tab crashes / renders blank).
  // Env-driven (never committed) — set GOOGLE_MAPS_API_KEY in .env locally and
  // as an EAS secret for builds. Restrict the key by package + signing SHA-1
  // in Google Cloud Console.
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  // Pins for Module 13 / SEC-019 — comma-separated list per domain,
  // env-driven so we can rotate without rebuilding the JS bundle.
  //   PIN_DOMAIN_API=api.chathouse.com
  //   PIN_API_PRIMARY=sha256/AAAA...      PIN_API_BACKUP=sha256/BBBB...
  // Empty in dev → plugin no-ops. Set in EAS secrets for staging/prod.
  const pinningDomains = {};
  const pinDomainApi = process.env.PIN_DOMAIN_API;
  const pinApiPins = [process.env.PIN_API_PRIMARY, process.env.PIN_API_BACKUP].filter(Boolean);
  if (pinDomainApi && pinApiPins.length > 0) pinningDomains[pinDomainApi] = pinApiPins;

  return {
    ...base.expo,
    // Append our local plugins to the static plugins list. We can't put
    // them in app.json because plugin paths in JSON have to be package
    // names; relative file paths only work via app.config.js.
    plugins: [
      ...(base.expo.plugins ?? []),
      // LiveKit live audio: the expo plugin wires the LiveKit native config
      // (audio session, Android foreground-service type), and the webrtc plugin
      // registers the @livekit/react-native-webrtc native module + mic
      // permission. Without these, prebuild produces a build with no WebRTC
      // native module and live audio silently falls back to 'unsupported'.
      '@livekit/react-native-expo-plugin',
      [
        '@config-plugins/react-native-webrtc',
        {
          cameraPermission: false,
          // Applied last, so this is the final iOS NSMicrophoneUsageDescription.
          // Covers both live rooms (LiveKit/WebRTC) and async voice messages
          // (expo-audio), which share the same OS microphone permission.
          microphonePermission:
            'Chathouse uses your microphone so you can speak in audio rooms and record voice messages.',
        },
      ],
      './plugins/with-gradle-jvm-heap',
      './plugins/with-audio-background',
      ['./plugins/with-cert-pinning', { domains: pinningDomains, includeSubdomains: true }],
      // Permit cleartext (HTTP) ONLY for local dev hosts (localhost / emulator)
      // so a release build can talk to a local HTTP backend over `adb reverse`.
      // Production domains still require HTTPS. Without this, Android blocks
      // cleartext in release and the app can't reach a local backend.
      './plugins/with-cleartext-localhost',
    ],
    // Merge Android-specific config. `config.googleMaps.apiKey` injects the
    // <meta-data com.google.android.geo.API_KEY> the Maps SDK needs.
    android: {
      ...base.expo.android,
      config: {
        ...(base.expo.android?.config ?? {}),
        googleMaps: { apiKey: googleMapsApiKey },
      },
    },
    // Override a few fields that should vary per env. Keep name/slug stable.
    extra: {
      API_BASE_URL: apiBaseUrl,
      WS_BASE_URL: wsBaseUrl,
      REALTIME_ENABLED: realtimeEnabled,
      ENV: envTag,
      SENTRY_DSN: sentryDsn,
      LIVEKIT_URL: livekitUrl,
    },
  };
};
