// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest, withDangerousMod, withInfoPlist } = require('@expo/config-plugins');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');

/**
 * Local Expo config plugin — certificate pinning (Module 13 / SEC-019).
 *
 * Provides "config-level" pinning :
 *   - **Android** : generates `android/app/src/main/res/xml/network_security_config.xml`
 *     declaring the pinned domains + pin set, and references it from
 *     AndroidManifest via `android:networkSecurityConfig`.
 *   - **iOS**     : adds `NSPinnedDomains` under `NSAppTransportSecurity`
 *     in Info.plist (works on iOS 14+ via the system URL loader).
 *
 * **What this does NOT do** : it does not perform "hard" cert validation
 * inside React Native's networking layer (axios/socket.io). Hard pinning
 * for those requires a native module (e.g. `react-native-ssl-pinning`) —
 * out of scope for a config plugin. The system-level pinning here covers
 * any traffic that goes through OkHttp/NSURLSession, which is the
 * majority for typical apps.
 *
 * Usage in `app.config.js` :
 *   plugins: [
 *     ...,
 *     ['./plugins/with-cert-pinning', {
 *       domains: {
 *         'api.chathouse.com': ['sha256/AAAAAAAAAA...', 'sha256/BBBBBBBB...'],
 *         'agora.io':          ['sha256/CCCCCCCC...'],
 *       },
 *       includeSubdomains: true,
 *     }],
 *   ],
 */

const ANDROID_XML_FILENAME = 'network_security_config.xml';

const buildAndroidNsc = (domains, includeSubdomains) => {
  const escape = s => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const entries = Object.entries(domains)
    .map(([domain, pins]) => {
      const pinTags = pins
        .map(pin => `      <pin digest="SHA-256">${escape(pin.replace(/^sha256\//, ''))}</pin>`)
        .join('\n');
      return [
        `  <domain-config>`,
        `    <domain includeSubdomains="${includeSubdomains ? 'true' : 'false'}">${escape(domain)}</domain>`,
        `    <pin-set>`,
        pinTags,
        `    </pin-set>`,
        `  </domain-config>`,
      ].join('\n');
    })
    .join('\n');
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<network-security-config>`,
    entries,
    `  <base-config cleartextTrafficPermitted="false" />`,
    `</network-security-config>`,
    '',
  ].join('\n');
};

const withAndroid = (config, opts) =>
  withDangerousMod(config, [
    'android',
    async cfg => {
      const xmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      const xmlPath = path.join(xmlDir, ANDROID_XML_FILENAME);
      fs.mkdirSync(xmlDir, { recursive: true });
      const xml = buildAndroidNsc(opts.domains, opts.includeSubdomains !== false);
      fs.writeFileSync(xmlPath, xml, 'utf8');
      return cfg;
    },
  ]);

const withAndroidManifestRef = config =>
  withAndroidManifest(config, async mod => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app) return mod;
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return mod;
  });

const withIos = (config, opts) =>
  withInfoPlist(config, mod => {
    const nsd = {};
    for (const [domain, pins] of Object.entries(opts.domains)) {
      nsd[domain] = {
        NSIncludesSubdomains: opts.includeSubdomains !== false,
        NSPinnedCAIdentities: [],
        NSPinnedLeafIdentities: pins.map(pin => ({
          SPKI: pin.replace(/^sha256\//, ''),
          HashAlgorithm: 'sha256',
        })),
      };
    }
    const ats = mod.modResults.NSAppTransportSecurity ?? {};
    ats.NSPinnedDomains = { ...(ats.NSPinnedDomains ?? {}), ...nsd };
    mod.modResults.NSAppTransportSecurity = ats;
    return mod;
  });

const withCertPinning = (config, props) => {
  const opts = {
    domains: (props && props.domains) || {},
    includeSubdomains: props ? props.includeSubdomains : true,
  };
  if (Object.keys(opts.domains).length === 0) {
    // No domains configured → no-op, but warn at build time
    // eslint-disable-next-line no-console
    console.warn('[with-cert-pinning] No domains supplied — pinning skipped.');
    return config;
  }
  let cfg = withAndroid(config, opts);
  cfg = withAndroidManifestRef(cfg);
  cfg = withIos(cfg, opts);
  return cfg;
};

module.exports = withCertPinning;
