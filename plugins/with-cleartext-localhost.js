// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

/**
 * Local Expo config plugin — permits cleartext (plain HTTP) traffic ONLY for
 * local development/test hosts (localhost, 127.0.0.1, Android emulator loopback
 * 10.0.2.2 / 10.0.3.2).
 *
 * Why: Android 9+ blocks cleartext HTTP by default in RELEASE builds. When the
 * app talks to a LOCAL HTTP backend (e.g. over `adb reverse` on a USB device,
 * or an emulator), the release build fails every request with
 * "We couldn't reach the server" / a CLEARTEXT_NOT_PERMITTED network error.
 * Debug builds get `usesCleartextTraffic=true` injected automatically, which is
 * why this only bites release.
 *
 * This is prod-safe: the `base-config` keeps cleartext DISABLED for every other
 * domain, so real production endpoints still require HTTPS (and certificate
 * pinning via with-cert-pinning is unaffected). For wireless testing against a
 * LAN backend, add the PC's LAN IP as another <domain> below.
 */
const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="true">localhost</domain>
    <domain includeSubdomains="true">127.0.0.1</domain>
    <domain includeSubdomains="true">10.0.2.2</domain>
    <domain includeSubdomains="true">10.0.3.2</domain>
  </domain-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;

const withCleartextLocalhost = config => {
  // 1. Write res/xml/network_security_config.xml into the generated project.
  config = withDangerousMod(config, [
    'android',
    async cfg => {
      const xmlDir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), NETWORK_SECURITY_CONFIG);
      return cfg;
    },
  ]);

  // 2. Reference it from the <application> element.
  config = withAndroidManifest(config, cfg => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });

  return config;
};

module.exports = withCleartextLocalhost;
