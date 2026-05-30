# plugins/

Local Expo config plugins. Each plugin is a small JS module that patches
the generated Android/iOS native code at `expo prebuild` / `eas build` time.

| Plugin                  | Purpose                                                                          | Wired in app.config.js?                       |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| `with-gradle-jvm-heap`  | Bumps Gradle JVM heap to 4 GB                                                    | ✅ (legacy)                                   |
| `with-audio-background` | Android foreground service + permissions for background audio (Module 6.7)       | ❌ — needs to be added                        |
| `with-cert-pinning`     | Android Network Security Config + iOS NSAppTransportSecurity pinning (Module 13) | ❌ — needs to be added with domain+pin config |

## How to wire the new plugins

Edit `app.config.js` and extend the existing `plugins` line. Two options.

### Option A — simple (no per-env config)

```diff
- plugins: [...(base.expo.plugins ?? []), './plugins/with-gradle-jvm-heap'],
+ plugins: [
+   ...(base.expo.plugins ?? []),
+   './plugins/with-gradle-jvm-heap',
+   './plugins/with-audio-background',
+   ['./plugins/with-cert-pinning', {
+     domains: {
+       'api.chathouse.com':   ['sha256/REPLACE_ME_BASE64_PIN_1', 'sha256/REPLACE_ME_BASE64_PIN_2'],
+       'agora.io':            ['sha256/REPLACE_ME_BASE64_PIN_3'],
+     },
+     includeSubdomains: true,
+   }],
+ ],
```

### Option B — env-driven (recommended for prod)

Read the pins from env so the same code ships across dev/staging/prod with
different pin sets :

```js
const pinDomain = process.env.PIN_DOMAIN;
const pinSpkiPrimary = process.env.PIN_SPKI_PRIMARY;
const pinSpkiBackup = process.env.PIN_SPKI_BACKUP;

const pinningPlugin =
  pinDomain && pinSpkiPrimary
    ? [
        [
          './plugins/with-cert-pinning',
          {
            domains: { [pinDomain]: [pinSpkiPrimary, pinSpkiBackup].filter(Boolean) },
            includeSubdomains: true,
          },
        ],
      ]
    : [];

return {
  ...base.expo,
  plugins: [
    ...(base.expo.plugins ?? []),
    './plugins/with-gradle-jvm-heap',
    './plugins/with-audio-background',
    ...pinningPlugin,
  ],
  // ...rest of config
};
```

## Generating SHA-256 SPKI pins for a domain

```bash
# Replace <host> with your backend domain. This computes the SubjectPublicKeyInfo
# pin in base64 — paste the output (without trailing newline) after "sha256/" in
# the plugin config.
openssl s_client -connect <host>:443 -servername <host> < /dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary \
  | base64
```

Always pin at least **2 keys** (primary + backup) so a key rotation doesn't
brick installed clients.

## Limits — what these plugins DO NOT cover

- **JS-side pinning** (axios / socket.io). React Native goes through the
  system URL loader (OkHttp on Android, NSURLSession on iOS) which both
  honour these config-level pins. But if you use Node-style libs that
  bring their own TLS stack inside the JS engine (uncommon in RN), those
  bypass the pins.
- **Hard pinning with custom logic** (e.g. reject if pin missing _and_
  show in-app warning). Requires a native module like
  `react-native-ssl-pinning`. The config-plugins approach above fails
  closed at the OS layer instead.

## EAS Build

After wiring the plugins :

```bash
eas build --profile development --platform ios       # iOS dev-client
eas build --profile development --platform android   # Android dev-client
```

The dev-client is what unblocks :

- Real background audio (the `UIBackgroundModes` and Android FGS plugin take effect)
- Mediasoup native pipeline (which Expo Go can't load — `MEDIASOUP_ENABLED=false` in dev)
- Cert pinning at the OS layer
- Agora native SDK (already declared in package.json but Expo Go can't link it)

EAS Build minutes are consumed per build (~15 min per platform on the free tier).
