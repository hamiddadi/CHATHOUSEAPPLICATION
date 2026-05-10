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

  // Agora — App ID is public, temp token is short-lived (24h max). The
  // PRIMARY/SECONDARY certificates are SECRETS and must live ONLY in the
  // backend's .env (used to sign per-room tokens). Never expose them via
  // expoConfig.extra.
  const agoraAppId = process.env.AGORA_APP_ID;
  const agoraChannel = process.env.AGORA_CHANNEL_NAME ?? 'CHATHOUSE';
  const agoraTempToken = process.env.AGORA_TEMP_TOKEN;

  return {
    ...base.expo,
    // Append our local "JVM heap" plugin to the static plugins list. We
    // can't put it in app.json because plugin paths in JSON have to be
    // package names; relative file paths only work via app.config.js.
    plugins: [...(base.expo.plugins ?? []), './plugins/with-gradle-jvm-heap'],
    // Override a few fields that should vary per env. Keep name/slug stable.
    extra: {
      API_BASE_URL: apiBaseUrl,
      WS_BASE_URL: wsBaseUrl,
      REALTIME_ENABLED: realtimeEnabled,
      ENV: envTag,
      SENTRY_DSN: sentryDsn,
      AGORA_APP_ID: agoraAppId,
      AGORA_DEFAULT_CHANNEL: agoraChannel,
      AGORA_TEMP_TOKEN: agoraTempToken,
    },
  };
};
