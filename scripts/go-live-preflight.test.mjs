import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildPublicEndpoints,
  hasPlaceholder,
  legalDraftReasons,
  main,
  parseEnv,
  plistString,
  validateAndroidAab16KbCompatibility,
  validateAndroidBundlePageAlignment,
  validateLegalDocumentAlignment,
  validateLegalPublicationControl,
  validateStoreListingMetadata,
  validateAndroidNativeConfiguration,
  validateAndroidFirebaseData,
  validateBackendReleaseIdentifiers,
  validateElfLoadAlignment,
  validateAndroidManifestTargetSdk,
  validateIosFirebaseText,
  validateIosNativeConfiguration,
  validatePublicUrl,
  validateProductionLiveKitAndStripe,
} from './go-live-preflight.mjs';

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
}

test('source scope rejects tracked and untracked changes', async t => {
  const repository = mkdtempSync(path.join(tmpdir(), 'chathouse-preflight-test-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  const trackedFile = path.join(repository, 'README.md');
  const untrackedFile = path.join(repository, 'untracked.txt');

  git(repository, ['init', '--quiet']);
  writeFileSync(trackedFile, 'committed\n', 'utf8');
  git(repository, ['add', 'README.md']);
  git(repository, [
    '-c',
    'user.name=Preflight Test',
    '-c',
    'user.email=preflight@example.test',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ]);

  assert.equal(await main(['--root', repository, '--scope', 'source']), 0);

  const reportDirectory = path.join(repository, 'artifacts');
  mkdirSync(reportDirectory);
  writeFileSync(path.join(reportDirectory, 'go-live-preflight.json'), '{}\n', 'utf8');
  assert.equal(
    await main([
      '--root',
      repository,
      '--scope',
      'source',
      '--report',
      'artifacts/go-live-preflight.json',
    ]),
    0,
  );
  rmSync(reportDirectory, { recursive: true, force: true });

  writeFileSync(untrackedFile, 'not committed\n', 'utf8');
  assert.equal(await main(['--root', repository, '--scope', 'source']), 1);

  unlinkSync(untrackedFile);
  writeFileSync(trackedFile, 'modified\n', 'utf8');
  assert.equal(await main(['--root', repository, '--scope', 'source']), 1);
});

test('public legal endpoint defaults stay on the production API host', () => {
  const endpoints = buildPublicEndpoints({}, {});
  assert.equal(endpoints.support, 'https://api.chathouse.app/support');
  assert.equal(endpoints.support_fr, 'https://api.chathouse.app/support?lang=fr');
  assert.equal(endpoints.terms, 'https://api.chathouse.app/terms');
  assert.equal(endpoints.terms_fr, 'https://api.chathouse.app/terms?lang=fr');
});

test('production LiveKit/Stripe contract keeps Stripe optional but atomic', () => {
  const livekitOnly = {
    EXTENSIONS_ENABLED: 'true',
    JWT_ACCESS_SECRET: 'access-secret-that-is-at-least-32-chars',
    JWT_REFRESH_SECRET: 'refresh-secret-that-is-at-least-32-chars',
    MEDIA_URL_SIGNING_SECRET: 'media-secret-that-is-at-least-32-chars',
    LIVEKIT_URL: 'wss://audio.chathouse.app',
    LIVEKIT_INTERNAL_URL: 'http://livekit:7880',
    LIVEKIT_API_KEY: 'APIproduction123',
    LIVEKIT_API_SECRET: 'livekit-secret-that-is-at-least-32-characters',
  };

  assert.match(validateProductionLiveKitAndStripe(livekitOnly), /Stripe désactivé/u);
  assert.throws(
    () =>
      validateProductionLiveKitAndStripe({
        ...livekitOnly,
        LIVEKIT_URL: 'ws://127.0.0.1:7880',
      }),
    /protocole requis: wss/u,
  );
  assert.throws(
    () =>
      validateProductionLiveKitAndStripe({
        ...livekitOnly,
        LIVEKIT_API_SECRET: 'too-short',
      }),
    /au moins 32/u,
  );
  assert.throws(
    () =>
      validateProductionLiveKitAndStripe({
        ...livekitOnly,
        LIVEKIT_API_SECRET: livekitOnly.JWT_ACCESS_SECRET,
      }),
    /secrets distincts/u,
  );

  const stripeEnabled = {
    ...livekitOnly,
    STRIPE_SECRET_KEY: `sk_live_${'A'.repeat(24)}`,
    STRIPE_WEBHOOK_SECRET: `whsec_${'B'.repeat(24)}`,
    STRIPE_RETURN_URL: 'https://app.chathouse.com/payments/return',
    STRIPE_REFRESH_URL: 'https://app.chathouse.com/payments/refresh',
  };
  assert.match(validateProductionLiveKitAndStripe(stripeEnabled), /Stripe activé et complet/u);
  assert.throws(
    () =>
      validateProductionLiveKitAndStripe({
        ...livekitOnly,
        STRIPE_SECRET_KEY: stripeEnabled.STRIPE_SECRET_KEY,
      }),
    /configuration Stripe partielle/u,
  );
  assert.throws(
    () => validateProductionLiveKitAndStripe({ ...stripeEnabled, EXTENSIONS_ENABLED: 'false' }),
    /EXTENSIONS_ENABLED doit être true/u,
  );
  assert.throws(
    () =>
      validateProductionLiveKitAndStripe({
        ...stripeEnabled,
        STRIPE_SECRET_KEY: `sk_test_${'A'.repeat(24)}`,
      }),
    /sk_live_/u,
  );
  assert.throws(
    () =>
      validateProductionLiveKitAndStripe({
        ...stripeEnabled,
        STRIPE_RETURN_URL: 'https://payments.local/return',
      }),
    /hôte local ou privé interdit/u,
  );
});

test('parseEnv handles comments, quotes, BOM and last-value-wins', () => {
  const values = parseEnv(
    '\uFEFF# comment\nENV = development\nAPI="https://api.chathouse.app/api"\nENV=production\n',
  );

  assert.deepEqual(values, {
    ENV: 'production',
    API: 'https://api.chathouse.app/api',
  });
});

test('validatePublicUrl accepts public TLS URLs', () => {
  assert.equal(
    validatePublicUrl('https://api.chathouse.app/api', ['https:']).hostname,
    'api.chathouse.app',
  );
  assert.equal(validatePublicUrl('wss://livekit.chathouse.app', ['wss:']).protocol, 'wss:');
});

test('validatePublicUrl rejects local, cleartext and placeholder URLs', () => {
  assert.throws(
    () => validatePublicUrl('http://api.chathouse.app', ['https:']),
    /protocole requis/u,
  );
  assert.throws(() => validatePublicUrl('https://127.0.0.1:4000', ['https:']), /local ou privé/u);
  assert.throws(
    () => validatePublicUrl('https://your-project.livekit.cloud', ['https:']),
    /placeholder/u,
  );
});

test('validateAndroidFirebaseData requires a real matching app client', () => {
  const project = validateAndroidFirebaseData({
    project_info: { project_id: 'chathouse-production' },
    client: [
      {
        client_info: {
          mobilesdk_app_id: '1:123456789:android:abcdef0123456789',
          android_client_info: { package_name: 'com.chathouse.app' },
        },
        api_key: [{ current_key: `AIza${'A'.repeat(35)}` }],
      },
    ],
  });

  assert.equal(project, 'chathouse-production');
  assert.throws(
    () =>
      validateAndroidFirebaseData({
        project_info: { project_id: 'chathouse-ci-placeholder' },
        client: [],
      }),
    /aucun client/u,
  );
});

test('backend release identifiers match the Apple team and Play signing certificate', () => {
  const fingerprint = Array.from({ length: 32 }, (_, index) =>
    index.toString(16).padStart(2, '0'),
  ).join(':');
  const values = {
    APPLE_TEAM_ID: 'A1B2C3D4E5',
    ANDROID_APP_SIGNING_SHA256: fingerprint,
  };

  assert.deepEqual(
    validateBackendReleaseIdentifiers(values, {
      GO_LIVE_IOS_TEAM_ID: 'A1B2C3D4E5',
      GO_LIVE_ANDROID_APP_SIGNING_SHA256: fingerprint.replaceAll(':', ''),
    }),
    {
      appleTeamId: 'A1B2C3D4E5',
      androidAppSigningSha256: fingerprint.replaceAll(':', '').toUpperCase(),
    },
  );
  assert.throws(
    () =>
      validateBackendReleaseIdentifiers(values, {
        GO_LIVE_IOS_TEAM_ID: 'Z9Y8X7W6V5',
      }),
    /diffère/u,
  );
  assert.throws(
    () =>
      validateBackendReleaseIdentifiers({
        ...values,
        ANDROID_APP_SIGNING_SHA256: fingerprint.replaceAll(':', ''),
      }),
    /colonisé/u,
  );
  assert.throws(
    () =>
      validateBackendReleaseIdentifiers({
        ...values,
        APPLE_TEAM_ID: 'TESTTEAMID',
      }),
    /APPLE_TEAM_ID/u,
  );
  assert.throws(
    () =>
      validateBackendReleaseIdentifiers({
        ...values,
        ANDROID_APP_SIGNING_SHA256: Array(32).fill('00').join(':'),
      }),
    /ANDROID_APP_SIGNING_SHA256/u,
  );
});

test('validateIosFirebaseText validates the bundle and production identifiers', () => {
  const plist = `<?xml version="1.0"?>
<plist><dict>
  <key>BUNDLE_ID</key><string>com.chathouse.app</string>
  <key>PROJECT_ID</key><string>chathouse-production</string>
  <key>GCM_SENDER_ID</key><string>123456789</string>
  <key>GOOGLE_APP_ID</key><string>1:123456789:ios:abcdef0123456789</string>
  <key>API_KEY</key><string>AIza${'B'.repeat(35)}</string>
</dict></plist>`;

  assert.equal(plistString(plist, 'BUNDLE_ID'), 'com.chathouse.app');
  assert.equal(validateIosFirebaseText(plist), 'chathouse-production');
  assert.throws(
    () => validateIosFirebaseText(plist.replace('com.chathouse.app', 'com.example.app')),
    /BUNDLE_ID/u,
  );
});

test('legalDraftReasons blocks draft markers and bracketed legal placeholders', () => {
  assert.deepEqual(legalDraftReasons('Final reviewed legal copy.'), []);
  assert.match(legalDraftReasons('Not publishable as-is. [Legal entity name]')[0], /brouillon/u);
  assert.match(legalDraftReasons('Release blocker — not publishable yet.')[0], /brouillon/u);
  assert.match(
    legalDraftReasons('Blocage de mise en production — pas encore publiable.')[0],
    /brouillon/u,
  );
  assert.match(legalDraftReasons('Working inventory for Store answers.')[0], /brouillon/u);
  assert.equal(hasPlaceholder('[DPO name]'), true);
  assert.equal(hasPlaceholder('[registered address]'), true);
  assert.equal(hasPlaceholder('__PLAY_CONSOLE_RELEASE_REFERENCE__'), true);
  assert.equal(hasPlaceholder('TBD'), true);
  assert.equal(hasPlaceholder('Pending confirmation'), true);
});

test('legal document control detects version and language divergence', () => {
  const control = {
    schemaVersion: 1,
    productName: 'ChatHouse',
    status: 'draft',
    version: '2026-07-29',
    lastReviewedDate: '2026-07-29',
    effectiveDate: null,
    defaultLanguage: 'en',
    supportedLanguages: ['en', 'fr'],
    documents: {
      privacy: {
        route: '/privacy',
        files: {
          en: 'docs/legal/PRIVACY-POLICY.md',
          fr: 'docs/legal/PRIVACY-POLICY.fr.md',
        },
      },
      terms: {
        route: '/terms',
        files: { en: 'docs/legal/EULA.md', fr: 'docs/legal/EULA.fr.md' },
      },
      communityGuidelines: {
        route: '/community-guidelines',
        files: {
          en: 'docs/legal/COMMUNITY-GUIDELINES.md',
          fr: 'docs/legal/COMMUNITY-GUIDELINES.fr.md',
        },
      },
      childSafety: {
        route: '/child-safety',
        files: {
          en: 'docs/legal/CHILD-SAFETY-STANDARDS.md',
          fr: 'docs/legal/CHILD-SAFETY-STANDARDS.fr.md',
        },
      },
    },
    storeInventories: [
      'docs/store/listing.md',
      'docs/store/apple-app-privacy.md',
      'docs/store/google-play-data-safety.md',
    ],
  };
  const documentSources = Object.fromEntries(
    Object.values(control.documents).flatMap(descriptor =>
      Object.entries(descriptor.files).map(([language, filePath]) => [
        filePath,
        language === 'fr'
          ? '**Version du document :** `2026-07-29`\n**Langue :** Français (`fr`)\n'
          : '**Document version:** `2026-07-29`\n**Language:** English (`en`)\n',
      ]),
    ),
  );
  const storeSources = Object.fromEntries(
    control.storeInventories.map(filePath => [
      filePath,
      '**Legal document set version:** `2026-07-29`\n',
    ]),
  );
  const input = {
    control,
    documentSources,
    storeSources,
    backendMetadataSource: "LEGAL_DOCUMENT_FALLBACK_VERSION = '2026-07-29'",
    mobileMetadataSource: "LEGAL_DOCUMENT_VERSION ?? '2026-07-29'",
    mobileVersion: '2026-07-29',
  };

  assert.match(validateLegalDocumentAlignment(input), /8 documents/u);
  assert.throws(() => validateLegalPublicationControl(control), /statut draft/u);
  assert.throws(
    () =>
      validateLegalDocumentAlignment({
        ...input,
        mobileVersion: '2026-07-30',
      }),
    /mobile .* différente/u,
  );
  assert.throws(
    () =>
      validateLegalDocumentAlignment({
        ...input,
        documentSources: {
          ...documentSources,
          'docs/legal/EULA.fr.md':
            '**Version du document :** `2026-07-28`\n**Langue :** Français (`fr`)\n',
        },
      }),
    /divergente/u,
  );
});

test('store listing validator enforces identity and console text limits', () => {
  const listing = `
- **App name:** \`ChatHouse\`
- **Bundle ID / package:** \`com.chathouse.app\`
- **Apple subtitle (≤30 chars):** \`Live audio rooms\`
- **Google short description (≤80 chars):** \`Talk live with friends.\`
- **Apple keywords (≤100 chars, comma-separated):**
  \`audio,live,friends\`

## Full description (≤4000 chars — both stores)

\`\`\`
Join a live conversation.
\`\`\`
`;

  assert.match(validateStoreListingMetadata(listing), /nom\/package alignés/u);
  assert.throws(
    () =>
      validateStoreListingMetadata(listing.replace('`Live audio rooms`', `\`${'x'.repeat(31)}\``)),
    /maximum 30/u,
  );
  assert.throws(
    () => validateStoreListingMetadata(listing.replace('`ChatHouse`', '`Other`')),
    /différent/u,
  );
});

test('validateAndroidNativeConfiguration keeps release TLS-only and debug local-capable', () => {
  const configuration = {
    buildGradle: `
      applicationId = 'com.chathouse.app'
      validateProductionReleaseConfiguration()
      System.getenv('ENVFILE') != '.env.production'
      productionEnv['REALTIME_ENABLED'] != 'true'
      validateProductionFirebase()
      validateReleaseSigning()
      gradle.taskGraph.whenReady {}
      CHATHOUSE_ALLOW_DEBUG_RELEASE_SIGNING
    `,
    gradleProperties: `
      android.minSdkVersion=24
      android.compileSdkVersion=36
      android.targetSdkVersion=36
      android.enableMinifyInReleaseBuilds=true
      android.enableShrinkResourcesInReleaseBuilds=true
      reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64
    `,
    manifest: `
      <manifest>
        <uses-permission android:name="android.permission.RECORD_AUDIO"/>
        <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
        <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE"/>
        <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"/>
        <application android:allowBackup="false" android:fullBackupContent="false"
          android:dataExtractionRules="@xml/data_extraction_rules"
          android:usesCleartextTraffic="false"
          android:networkSecurityConfig="@xml/network_security_config">
          <intent-filter android:autoVerify="true">
            <data android:scheme="https" android:host="app.chathouse.com"/>
          </intent-filter>
        </application>
      </manifest>
    `,
    debugManifest:
      '<application android:usesCleartextTraffic="true" tools:replace="android:usesCleartextTraffic"/>',
    debugOptimizedManifest:
      '<application android:usesCleartextTraffic="true" tools:replace="android:usesCleartextTraffic"/>',
    releaseNetworkSecurity:
      '<network-security-config><base-config cleartextTrafficPermitted="false"/></network-security-config>',
    debugNetworkSecurity:
      '<network-security-config><base-config cleartextTrafficPermitted="true"/></network-security-config>',
    debugOptimizedNetworkSecurity:
      '<network-security-config><base-config cleartextTrafficPermitted="true"/></network-security-config>',
  };

  assert.match(validateAndroidNativeConfiguration(configuration), /TLS-only/u);
  assert.throws(
    () =>
      validateAndroidNativeConfiguration({
        ...configuration,
        releaseNetworkSecurity: configuration.releaseNetworkSecurity.replace('false', 'true'),
      }),
    /interdire tout HTTP clair/u,
  );
});

function protobufVarint(input) {
  let value = BigInt(input);
  const bytes = [];
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function protobufField(number, wireType, value) {
  const key = protobufVarint((BigInt(number) << 3n) | BigInt(wireType));
  if (wireType === 0) return Buffer.concat([key, protobufVarint(value)]);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([key, protobufVarint(bytes.length), bytes]);
}

function bundleConfigFixture(alignment = 2, enabled = 1) {
  const nativeLibraries = Buffer.concat([
    protobufField(1, 0, enabled),
    protobufField(2, 0, alignment),
  ]);
  const optimizations = protobufField(2, 2, nativeLibraries);
  return protobufField(2, 2, optimizations);
}

function androidManifestFixture(targetSdk = 36) {
  const primitive = protobufField(6, 0, targetSdk);
  const compiledItem = protobufField(7, 2, primitive);
  const targetAttribute = Buffer.concat([
    protobufField(1, 2, 'http://schemas.android.com/apk/res/android'),
    protobufField(2, 2, 'targetSdkVersion'),
    protobufField(3, 2, String(targetSdk)),
    protobufField(6, 2, compiledItem),
  ]);
  const usesSdkElement = Buffer.concat([
    protobufField(3, 2, 'uses-sdk'),
    protobufField(4, 2, targetAttribute),
  ]);
  const rootElement = Buffer.concat([
    protobufField(3, 2, 'manifest'),
    protobufField(5, 2, protobufField(1, 2, usesSdkElement)),
  ]);
  return protobufField(1, 2, rootElement);
}

function elf64Fixture(alignment = 16384n) {
  const elf = Buffer.alloc(64 + 56);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(elf);
  elf[4] = 2;
  elf[5] = 1;
  elf[6] = 1;
  elf.writeUInt16LE(3, 16);
  elf.writeUInt16LE(183, 18);
  elf.writeUInt32LE(1, 20);
  elf.writeBigUInt64LE(64n, 32);
  elf.writeUInt16LE(64, 52);
  elf.writeUInt16LE(56, 54);
  elf.writeUInt16LE(1, 56);
  elf.writeUInt32LE(1, 64);
  elf.writeUInt32LE(5, 68);
  elf.writeBigUInt64LE(0n, 72);
  elf.writeBigUInt64LE(0n, 80);
  elf.writeBigUInt64LE(0n, 88);
  elf.writeBigUInt64LE(BigInt(elf.length), 96);
  elf.writeBigUInt64LE(BigInt(elf.length), 104);
  elf.writeBigUInt64LE(alignment, 112);
  return elf;
}

function zipFixture(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const value = Buffer.from(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(value.length, 18);
    local.writeUInt32LE(value.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, value);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(value.length, 20);
    central.writeUInt32LE(value.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + value.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const entryCount = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function androidAabFixture({
  alignment = 2,
  targetSdk = 36,
  elfAlignment = 16384n,
  bundleConfig = bundleConfigFixture(alignment),
  nativeLibrary = elf64Fixture(elfAlignment),
} = {}) {
  return zipFixture({
    'BundleConfig.pb': bundleConfig,
    'base/manifest/AndroidManifest.xml': androidManifestFixture(targetSdk),
    'base/lib/arm64-v8a/libfixture.so': nativeLibrary,
  });
}

test('Android AAB 16 KB validator checks bundle config, target SDK and every ELF', () => {
  assert.equal(validateAndroidBundlePageAlignment(bundleConfigFixture()), 'PAGE_ALIGNMENT_16K');
  assert.equal(validateAndroidBundlePageAlignment(bundleConfigFixture(3)), 'PAGE_ALIGNMENT_64K');
  assert.equal(validateAndroidManifestTargetSdk(androidManifestFixture()), 36);
  assert.equal(validateElfLoadAlignment(elf64Fixture()).minimumAlignment, 16384n);
  assert.deepEqual(validateAndroidAab16KbCompatibility(androidAabFixture()), {
    targetSdk: 36,
    pageAlignment: 'PAGE_ALIGNMENT_16K',
    nativeLibraries: 1,
  });

  assert.throws(
    () => validateAndroidAab16KbCompatibility(androidAabFixture({ alignment: 1 })),
    /PAGE_ALIGNMENT_4K.*PAGE_ALIGNMENT_16K/u,
  );
  assert.throws(
    () => validateAndroidAab16KbCompatibility(androidAabFixture({ targetSdk: 35 })),
    /targetSdkVersion 35.*36 requis/u,
  );
  assert.throws(
    () => validateAndroidAab16KbCompatibility(androidAabFixture({ elfAlignment: 4096n })),
    /base\/lib\/arm64-v8a\/libfixture\.so.*4096.*16384/u,
  );
});

test('Android AAB 16 KB validator rejects string and ELF lookalike fixtures', () => {
  assert.throws(
    () =>
      validateAndroidAab16KbCompatibility(
        androidAabFixture({
          bundleConfig: Buffer.from('PAGE_ALIGNMENT_16K', 'utf8'),
        }),
      ),
    /BundleConfig\.pb.*protobuf/u,
  );
  assert.throws(
    () =>
      validateAndroidAab16KbCompatibility(
        androidAabFixture({
          nativeLibrary: Buffer.from('ELF LOAD align 2**14', 'utf8'),
        }),
      ),
    /libfixture\.so.*ELF invalide/u,
  );
});

function pngFixture(colorType = 2) {
  const png = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1024, 16);
  png.writeUInt32BE(1024, 20);
  png[24] = 8;
  png[25] = colorType;
  png.writeUInt32BE(0, 33);
  png.write('IEND', 37, 'ascii');
  return png;
}

test('validateIosNativeConfiguration rejects alpha and placeholder store icons', () => {
  const configuration = {
    project: `
      PrivacyInfo.xcprivacy in Resources
      GoogleService-Info.plist in Resources
      scripts/bundle-react-native.sh
      /* Release */ = {
        buildSettings = {
          APS_ENVIRONMENT = production;
          PRODUCT_BUNDLE_IDENTIFIER = "com.chathouse.app";
          TARGETED_DEVICE_FAMILY = "1,2";
          CODE_SIGN_ENTITLEMENTS = ChatHouse/ChatHouse.entitlements;
          CODE_SIGN_STYLE = Automatic;
          ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
          CURRENT_PROJECT_VERSION = 1;
          MARKETING_VERSION = 1.0.0;
          SUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
        };
        name = Release;
      };
    `,
    infoPlist: `
      <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
      <string>chathouse</string>
      <key>NSLocationWhenInUseUsageDescription</key>
      <key>NSMicrophoneUsageDescription</key>
      <key>NSPhotoLibraryUsageDescription</key>
      <key>NSSpeechRecognitionUsageDescription</key>
      <key>NSAllowsArbitraryLoads</key><false/>
      <key>ITSAppUsesNonExemptEncryption</key><false/>
      <string>audio</string><string>remote-notification</string>
    `,
    entitlements: '<string>$(APS_ENVIRONMENT)</string><string>applinks:app.chathouse.com</string>',
    privacyManifest: `
      <key>NSPrivacyTracking</key><false/>
      <key>NSPrivacyCollectedDataTypes</key><array>
        <dict>
          <key>NSPrivacyCollectedDataType</key>
          <string>NSPrivacyCollectedDataTypeCrashData</string>
          <key>NSPrivacyCollectedDataTypeLinked</key><true/>
        </dict>
        <dict>
          <key>NSPrivacyCollectedDataType</key>
          <string>NSPrivacyCollectedDataTypePerformanceData</string>
          <key>NSPrivacyCollectedDataTypeLinked</key><true/>
        </dict>
      </array>
      <key>NSPrivacyAccessedAPITypes</key><array/>
    `,
    iconContents: JSON.stringify({
      images: [
        {
          filename: 'AppIcon.png',
          idiom: 'universal',
          platform: 'ios',
          size: '1024x1024',
        },
      ],
    }),
    icon: pngFixture(),
    placeholderIcon: null,
    bundleScript:
      'iOS device Release builds require ENVFILE=.env.production\nvalidate_firebase_plist',
  };

  assert.match(validateIosNativeConfiguration(configuration), /AppIcon validés/u);
  assert.throws(
    () => validateIosNativeConfiguration({ ...configuration, icon: pngFixture(6) }),
    /canal alpha/u,
  );
  assert.throws(
    () =>
      validateIosNativeConfiguration({
        ...configuration,
        placeholderIcon: configuration.icon,
      }),
    /PLACEHOLDER/u,
  );
});
