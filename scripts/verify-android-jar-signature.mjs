#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_TOOL_OUTPUT = 64 * 1024 * 1024;
const STORE_PASSWORD_ENV = 'CHATHOUSE_SIGNATURE_STORE_PASSWORD';

export function resolveJavaTool(name, override = process.env[`${name.toUpperCase()}_BIN`]) {
  if (override) return override;
  const javaHome = process.env.JAVA_HOME?.trim();
  if (javaHome) {
    const executable = process.platform === 'win32' ? `${name}.exe` : name;
    const candidate = join(javaHome, 'bin', executable);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.binary ? null : 'utf8',
    env: options.env ?? process.env,
    maxBuffer: MAX_TOOL_OUTPUT,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

export function inspectStrictJarsignerResult(result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const status = result.status;

  if (
    /jar is unsigned|unsigned entr(?:y|ies)|\?\s*=\s*unsigned entry/iu.test(output) ||
    /^\s*\?\s+\d+/mu.test(output)
  ) {
    throw new Error('Android artifact contains an unsigned JAR or unsigned entries');
  }
  // Android upload certificates are normally self-signed. With `-strict`, a
  // valid signature can therefore return bit 4 (certificate chain not trusted).
  // Every other strict bit is fatal, especially 16 for an unsigned JAR or
  // unsigned entries and 8/64 for certificate/timestamp expiry.
  if (status !== 0 && status !== 4) {
    throw new Error(`jarsigner strict verification failed with status ${status ?? 'unknown'}`);
  }
  if (!/jar verified(?:, with signer errors)?\./iu.test(output)) {
    throw new Error('jarsigner did not confirm a verified JAR signature');
  }
  if (/CN=Android Debug|androiddebugkey/iu.test(output)) {
    throw new Error('Android artifact uses the shared debug signer');
  }
  if (/Signature algorithm:[^\r\n]*(?:disabled|weak)/iu.test(output)) {
    throw new Error('Android artifact uses a disabled or weak signature algorithm');
  }
}

function firstPemCertificate(output) {
  const match = String(output).match(
    /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\r\n]+)-----END CERTIFICATE-----/u,
  );
  if (!match) throw new Error('artifact signer certificate is missing');
  return Buffer.from(match[1].replace(/\s/gu, ''), 'base64');
}

const sha256 = input => createHash('sha256').update(input).digest('hex');

export function verifyAndroidJarSignature({
  artifactPath,
  keystorePath,
  alias,
  storePassword,
  jarsignerCommand = resolveJavaTool('jarsigner'),
  keytoolCommand = resolveJavaTool('keytool'),
}) {
  if (!artifactPath || !keystorePath || !alias || !storePassword) {
    throw new Error('artifact, upload keystore, alias and store password are required');
  }

  const strictResult = run(
    jarsignerCommand,
    ['-verify', '-strict', '-verbose', '-certs', artifactPath],
    { env: { ...process.env, LANG: 'C', LC_ALL: 'C' } },
  );
  inspectStrictJarsignerResult(strictResult);

  const toolEnv = { ...process.env, [STORE_PASSWORD_ENV]: storePassword };
  const expectedCertificate = run(
    keytoolCommand,
    [
      '-exportcert',
      '-alias',
      alias,
      '-keystore',
      keystorePath,
      '-storepass:env',
      STORE_PASSWORD_ENV,
    ],
    { binary: true, env: toolEnv },
  );
  if (expectedCertificate.status !== 0 || !expectedCertificate.stdout?.length) {
    throw new Error('cannot export the expected Android upload certificate');
  }

  const artifactCertificate = run(keytoolCommand, ['-printcert', '-jarfile', artifactPath, '-rfc']);
  if (artifactCertificate.status !== 0) {
    throw new Error('cannot read the Android artifact signer certificate');
  }

  const expectedFingerprint = sha256(expectedCertificate.stdout);
  const artifactFingerprint = sha256(firstPemCertificate(artifactCertificate.stdout));
  if (artifactFingerprint !== expectedFingerprint) {
    throw new Error('Android artifact signer does not match the protected upload keystore');
  }
  return artifactFingerprint;
}

export function main(argv = process.argv.slice(2)) {
  const [artifactPath, keystorePath, alias] = argv;
  const fingerprint = verifyAndroidJarSignature({
    artifactPath,
    keystorePath,
    alias,
    storePassword: process.env.CHATHOUSE_UPLOAD_STORE_PASSWORD,
  });
  process.stdout.write(`${fingerprint}\n`);
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(
      `Android signature verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
