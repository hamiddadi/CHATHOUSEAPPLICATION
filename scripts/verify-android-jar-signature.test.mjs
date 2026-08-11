import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveJavaTool, verifyAndroidJarSignature } from './verify-android-jar-signature.mjs';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`,
  );
}

test('Android signature gate accepts the protected signer and rejects unsigned content', t => {
  const directory = mkdtempSync(join(tmpdir(), 'chathouse-android-signature-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const jar = resolveJavaTool('jar');
  const jarsigner = resolveJavaTool('jarsigner');
  const keytool = resolveJavaTool('keytool');
  const password = 'fixture-password-123';
  const alias = 'chathouse-upload-fixture';
  const unsignedJar = join(directory, 'unsigned.jar');
  const signedJar = join(directory, 'signed.jar');
  const partialJar = join(directory, 'partial.jar');
  const keystore = join(directory, 'upload.p12');

  writeFileSync(join(directory, 'payload.txt'), 'signed payload\n', 'utf8');
  run(jar, ['--create', '--file', unsignedJar, 'payload.txt'], { cwd: directory });
  run(keytool, [
    '-genkeypair',
    '-alias',
    alias,
    '-keystore',
    keystore,
    '-storetype',
    'PKCS12',
    '-storepass',
    password,
    '-keypass',
    password,
    '-dname',
    'CN=ChatHouse Upload Fixture, OU=Engineering, O=ChatHouse, C=US',
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '3650',
  ]);
  run(jarsigner, [
    '-keystore',
    keystore,
    '-storepass',
    password,
    '-keypass',
    password,
    '-signedjar',
    signedJar,
    unsignedJar,
    alias,
  ]);

  const verify = artifactPath =>
    verifyAndroidJarSignature({
      artifactPath,
      keystorePath: keystore,
      alias,
      storePassword: password,
      jarsignerCommand: jarsigner,
      keytoolCommand: keytool,
    });

  assert.match(verify(signedJar), /^[a-f0-9]{64}$/u);
  assert.throws(() => verify(unsignedJar), /strict verification|unsigned/u);

  writeFileSync(join(directory, 'later.txt'), 'unsigned addition\n', 'utf8');
  writeFileSync(partialJar, readFileSync(signedJar));
  run(jar, ['--update', '--file', partialJar, 'later.txt'], { cwd: directory });
  assert.throws(() => verify(partialJar), /strict verification|unsigned/u);
});
