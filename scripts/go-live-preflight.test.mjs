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
  validateAndroidFirebaseData,
  validateBackendReleaseIdentifiers,
  validateIosFirebaseText,
  validatePublicUrl,
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

test('public endpoint defaults keep support on the production API host', () => {
  assert.equal(buildPublicEndpoints({}, {}).support, 'https://api.chathouse.app/support');
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
  assert.equal(hasPlaceholder('[registered address]'), true);
  assert.equal(hasPlaceholder('__PLAY_CONSOLE_RELEASE_REFERENCE__'), true);
});
