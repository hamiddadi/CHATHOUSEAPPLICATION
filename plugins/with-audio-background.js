// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Local Expo config plugin — keeps audio playing when the app moves to
 * background on Android (Module 6.7 / AUDIO-016/017).
 *
 * What it does:
 *   1. Adds the `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
 *      permissions to AndroidManifest.xml (required for Android 14+).
 *   2. Declares a foreground service of type `mediaPlayback` so the OS
 *      keeps the process alive while a Chathouse room is active.
 *   3. Adds the `POST_NOTIFICATIONS` permission so we can display the
 *      mandatory ongoing-notification that goes with a foreground service
 *      on Android 13+.
 *
 * iOS background audio is already configured via
 * `app.json → ios.infoPlist.UIBackgroundModes = ["audio", "voip", …]`.
 *
 * The actual JS-side service is provided by the existing
 * `ExtBackToRoomBanner` (V10) — this plugin only patches the manifest so
 * the OS allows the runtime to do its job.
 *
 * Wire it up in `app.config.js`:
 *   plugins: [..., './plugins/with-audio-background']
 */

const SERVICE_NAME = 'com.chathouse.audio.RoomForegroundService';

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
];

const withAudioBackground = config =>
  withAndroidManifest(config, async mod => {
    const manifest = mod.modResults.manifest;

    // 1. Permissions — ensure each one exists exactly once
    if (!Array.isArray(manifest['uses-permission'])) manifest['uses-permission'] = [];
    const existing = new Set(
      manifest['uses-permission'].map(p => p.$['android:name']).filter(Boolean),
    );
    for (const perm of PERMISSIONS) {
      if (!existing.has(perm)) {
        manifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    }

    // 2. Service declaration under <application>. During `expo config
    // --type introspect` the manifest passed to plugins can be a minimal
    // stub without <application> — we skip the service registration in
    // that case (real EAS build always has it).
    const app = Array.isArray(manifest.application) ? manifest.application[0] : null;
    if (app) {
      if (!Array.isArray(app.service)) app.service = [];
      const alreadyDeclared = app.service.some(
        s => s.$ && s.$['android:name'] === SERVICE_NAME,
      );
      if (!alreadyDeclared) {
        app.service.push({
          $: {
            'android:name': SERVICE_NAME,
            'android:exported': 'false',
            'android:foregroundServiceType': 'mediaPlayback',
            'android:stopWithTask': 'true',
          },
        });
      }
    }

    return mod;
  });

module.exports = withAudioBackground;
