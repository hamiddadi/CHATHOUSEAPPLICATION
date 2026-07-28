#!/usr/bin/env node

/**
 * ChatHouse Android/iOS Go-Live preflight.
 *
 * This command is deliberately read-only, except for the optional JSON report.
 * It does not build, sign, upload, deploy, or submit anything. It validates the
 * exact source revision, production-only files, already-produced artifacts,
 * public endpoints, legal/store copy, and recorded store/device acceptance.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const PACKAGE_ID = 'com.chathouse.app';
const DEFAULT_SCOPES = ['source', 'production', 'android', 'ios', 'network', 'legal', 'evidence'];
const PLACEHOLDER_PATTERN =
  /(?:change[_ -]?me|placeholder|replace[-_. ]?with|your[-_. ]?project|example\.(?:com|net|org|test)|__[A-Za-z0-9][A-Za-z0-9_-]*__|\[(?:legal entity|registered address|address|authority|confirm|jurisdiction|…|\.\.\.)[^\]]*\])/i;
const DRAFT_PATTERN =
  /(?:not publishable as[- ]is|working draft|must resolve before submission|fill every .*placeholder|\b(?:todo|tbd)\b)/i;

export function parseEnv(text) {
  const values = {};
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function hasPlaceholder(value) {
  return !value || PLACEHOLDER_PATTERN.test(String(value));
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts.every(part => part === 0)
  );
}

export function validatePublicUrl(rawValue, allowedProtocols = ['https:']) {
  if (hasPlaceholder(rawValue)) {
    throw new Error('URL absente ou contenant un placeholder');
  }

  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('URL invalide');
  }

  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`protocole requis: ${allowedProtocols.join(' ou ')}`);
  }
  if (url.username || url.password) throw new Error('identifiants interdits dans une URL');
  if (!url.hostname || (!url.hostname.includes('.') && !url.hostname.includes(':'))) {
    throw new Error('hôte public pleinement qualifié requis');
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1' ||
    /^(?:fc|fd|fe[89ab])/iu.test(hostname) ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error('hôte local ou privé interdit');
  }

  return url;
}

export function buildPublicEndpoints(mobileEnv = {}, overrides = {}) {
  const apiUrl = mobileEnv.API_BASE_URL
    ? new URL(mobileEnv.API_BASE_URL)
    : new URL('https://api.chathouse.app/api');
  const livekitUrl = mobileEnv.LIVEKIT_URL
    ? new URL(mobileEnv.LIVEKIT_URL)
    : new URL('wss://livekit.chathouse.app');
  return {
    api_health: overrides.GO_LIVE_API_HEALTH_URL || `${apiUrl.origin}/health`,
    privacy: overrides.GO_LIVE_PRIVACY_URL || `${apiUrl.origin}/privacy`,
    account_deletion: overrides.GO_LIVE_ACCOUNT_DELETION_URL || `${apiUrl.origin}/account-deletion`,
    support: overrides.GO_LIVE_SUPPORT_URL || `${apiUrl.origin}/support`,
    app: overrides.GO_LIVE_APP_URL || 'https://app.chathouse.com',
    livekit:
      overrides.GO_LIVE_LIVEKIT_HTTPS_URL ||
      `https://${livekitUrl.host}${livekitUrl.pathname === '/' ? '' : livekitUrl.pathname}`,
  };
}

export function validateAndroidFirebaseData(data) {
  const client = data?.client?.find(
    candidate => candidate?.client_info?.android_client_info?.package_name === PACKAGE_ID,
  );
  const projectId = data?.project_info?.project_id ?? '';
  const appId = client?.client_info?.mobilesdk_app_id ?? '';
  const apiKey = client?.api_key?.find(candidate => candidate?.current_key)?.current_key ?? '';

  if (!client) throw new Error(`aucun client Firebase pour ${PACKAGE_ID}`);
  if (hasPlaceholder(projectId) || !/^[A-Za-z0-9][A-Za-z0-9._-]+$/u.test(projectId)) {
    throw new Error('PROJECT_ID Firebase Android absent ou factice');
  }
  if (!/^\d+:\d+:android:[0-9A-Fa-f]+$/u.test(appId)) {
    throw new Error('mobilesdk_app_id Android invalide');
  }
  if (!/^AIza[0-9A-Za-z_-]{35}$/u.test(apiKey)) {
    throw new Error('clé API Firebase Android invalide');
  }
  return projectId;
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

export function plistString(text, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = text.match(
    new RegExp(`<key>\\s*${escapedKey}\\s*<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`, 'u'),
  );
  return match ? decodeXml(match[1].trim()) : '';
}

export function validateIosFirebaseText(text) {
  const bundleId = plistString(text, 'BUNDLE_ID');
  const projectId = plistString(text, 'PROJECT_ID');
  const senderId = plistString(text, 'GCM_SENDER_ID');
  const appId = plistString(text, 'GOOGLE_APP_ID');
  const apiKey = plistString(text, 'API_KEY');

  if (bundleId !== PACKAGE_ID) throw new Error(`BUNDLE_ID Firebase doit être ${PACKAGE_ID}`);
  if (hasPlaceholder(projectId) || !/^[A-Za-z0-9][A-Za-z0-9._-]+$/u.test(projectId)) {
    throw new Error('PROJECT_ID Firebase iOS absent ou factice');
  }
  if (!/^\d+$/u.test(senderId)) throw new Error('GCM_SENDER_ID Firebase iOS invalide');
  if (!/^\d+:\d+:ios:[0-9A-Fa-f]+$/u.test(appId)) {
    throw new Error('GOOGLE_APP_ID Firebase iOS invalide');
  }
  if (!/^AIza[0-9A-Za-z_-]{35}$/u.test(apiKey)) {
    throw new Error('clé API Firebase iOS invalide');
  }
  return projectId;
}

export function legalDraftReasons(text) {
  const reasons = [];
  if (DRAFT_PATTERN.test(text)) reasons.push('mention explicite de brouillon/non-publication');
  if (PLACEHOLDER_PATTERN.test(text)) reasons.push('placeholder non remplacé');
  return reasons;
}

export function validateBackendReleaseIdentifiers(values, requested = {}) {
  if (!/^[A-Z0-9]{10}$/u.test(values.APPLE_TEAM_ID ?? '')) {
    throw new Error('APPLE_TEAM_ID backend doit contenir 10 caractères alphanumériques');
  }
  const backendAndroidFingerprint = normalizeFingerprint(values.ANDROID_APP_SIGNING_SHA256);
  if (
    !/^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/u.test(values.ANDROID_APP_SIGNING_SHA256 ?? '') ||
    !/^[A-F0-9]{64}$/u.test(backendAndroidFingerprint)
  ) {
    throw new Error('ANDROID_APP_SIGNING_SHA256 backend doit être colonisé sur 32 octets');
  }
  if (requested.GO_LIVE_IOS_TEAM_ID && requested.GO_LIVE_IOS_TEAM_ID !== values.APPLE_TEAM_ID) {
    throw new Error('APPLE_TEAM_ID backend diffère de GO_LIVE_IOS_TEAM_ID');
  }
  const requestedAndroidFingerprint = normalizeFingerprint(
    requested.GO_LIVE_ANDROID_APP_SIGNING_SHA256,
  );
  if (requestedAndroidFingerprint && requestedAndroidFingerprint !== backendAndroidFingerprint) {
    throw new Error(
      'ANDROID_APP_SIGNING_SHA256 backend diffère de GO_LIVE_ANDROID_APP_SIGNING_SHA256',
    );
  }
  return {
    appleTeamId: values.APPLE_TEAM_ID,
    androidAppSigningSha256: backendAndroidFingerprint,
  };
}

function requireFile(filePath, label) {
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`${label} introuvable: ${filePath || '(chemin absent)'}`);
  }
  return filePath;
}

function requireDirectory(directoryPath, label) {
  if (!directoryPath || !existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
    throw new Error(`${label} introuvable: ${directoryPath || '(chemin absent)'}`);
  }
  return directoryPath;
}

function readText(filePath, label) {
  return readFileSync(requireFile(filePath, label), 'utf8').replace(/^\uFEFF/u, '');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.binary ? null : 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${command} indisponible: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : (result.stderr ?? '');
    const stdout = Buffer.isBuffer(result.stdout)
      ? result.stdout.toString('utf8')
      : (result.stdout ?? '');
    const diagnostic = `${stderr}\n${stdout}`.trim().split(/\r?\n/u).slice(-3).join(' | ');
    throw new Error(`${command} a échoué${diagnostic ? `: ${diagnostic}` : ''}`);
  }
  return result.stdout;
}

function resolveCommand(name) {
  if (!process.env.JAVA_HOME) return name;
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const candidate = path.join(process.env.JAVA_HOME, 'bin', executable);
  return existsSync(candidate) ? candidate : name;
}

function certificateDerFromPem(output, label) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  const match = text.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/u);
  if (!match) throw new Error(`certificat ${label} illisible`);
  return Buffer.from(match[1].replace(/\s/gu, ''), 'base64');
}

function fingerprint(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function normalizeFingerprint(value) {
  return String(value ?? '')
    .replace(/[^0-9A-Fa-f]/gu, '')
    .toUpperCase();
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

class Reporter {
  constructor({ root, scopes, reportPath }) {
    this.root = root;
    this.scopes = scopes;
    this.reportPath = reportPath;
    this.results = [];
    this.revision = null;
  }

  async check(category, id, action) {
    try {
      const detail = await action();
      this.results.push({
        category,
        id,
        status: 'PASS',
        message: typeof detail === 'string' ? detail : 'validé',
      });
    } catch (error) {
      this.results.push({
        category,
        id,
        status: 'FAIL',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  printAndWrite() {
    const failures = this.results.filter(result => result.status === 'FAIL');
    const passes = this.results.length - failures.length;
    const verdict = failures.length === 0 ? 'GO' : 'NO-GO';

    console.log('ChatHouse — préflight Go-Live Android/iOS');
    console.log(`Révision: ${this.revision ?? 'inconnue'}`);
    console.log(`Périmètre: ${this.scopes.join(', ')}`);
    console.log('');
    for (const result of this.results) {
      const icon = result.status === 'PASS' ? 'PASS' : 'FAIL';
      console.log(`[${icon}] ${result.category}/${result.id} — ${result.message}`);
    }
    console.log('');
    console.log(`Verdict: ${verdict} (${passes} succès, ${failures.length} blocage(s))`);

    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      revision: this.revision,
      scopes: this.scopes,
      verdict,
      counts: { passed: passes, failed: failures.length },
      checks: this.results,
    };
    if (this.reportPath) {
      const absoluteReport = path.resolve(this.root, this.reportPath);
      const reportParent = path.dirname(absoluteReport);
      if (!existsSync(reportParent)) {
        throw new Error(`répertoire du rapport absent: ${reportParent}`);
      }
      writeFileSync(absoluteReport, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(`Rapport JSON: ${absoluteReport}`);
    }
    return failures.length === 0 ? 0 : 1;
  }
}

function parseArgs(argv) {
  const options = {
    root: process.env.GO_LIVE_ROOT || DEFAULT_ROOT,
    scopes: DEFAULT_SCOPES,
    reportPath: process.env.GO_LIVE_REPORT || '',
    timeoutMs: Number(process.env.GO_LIVE_HTTP_TIMEOUT_MS || 10000),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') options.root = argv[++index];
    else if (arg === '--scope') options.scopes = argv[++index].split(',').filter(Boolean);
    else if (arg === '--report') options.reportPath = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/go-live-preflight.mjs [options]',
          '',
          'Options:',
          `  --scope source,production,android,ios,network,legal,evidence`,
          '  --root PATH             Racine du dépôt',
          '  --report PATH           Rapport JSON (chemin relatif à la racine accepté)',
          '  --timeout-ms NUMBER     Timeout par requête HTTPS',
          '',
          'Cette commande valide uniquement des preuves existantes; elle ne construit,',
          'ne signe, ne déploie et ne soumet aucun artefact.',
        ].join('\n'),
      );
      return null;
    } else {
      throw new Error(`option inconnue: ${arg}`);
    }
  }

  const invalidScopes = options.scopes.filter(scope => !DEFAULT_SCOPES.includes(scope));
  if (invalidScopes.length) throw new Error(`périmètre inconnu: ${invalidScopes.join(', ')}`);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout-ms doit être supérieur ou égal à 1000');
  }
  options.root = path.resolve(options.root);
  return options;
}

function productionPaths(root) {
  const resolveFromRoot = (configured, fallback) => path.resolve(root, configured || fallback);
  return {
    mobileEnv: resolveFromRoot(process.env.GO_LIVE_ENV_FILE, '.env.production'),
    backendEnv: resolveFromRoot(
      process.env.GO_LIVE_BACKEND_ENV_FILE,
      path.join('backend', '.env.production'),
    ),
    androidFirebase: resolveFromRoot(
      process.env.GO_LIVE_ANDROID_FIREBASE,
      path.join('android', 'app', 'google-services.json'),
    ),
    iosFirebase: resolveFromRoot(
      process.env.GO_LIVE_IOS_FIREBASE,
      path.join('ios', 'ChatHouse', 'GoogleService-Info.plist'),
    ),
  };
}

function loadMobileEnv(root) {
  const envPath = productionPaths(root).mobileEnv;
  const values = parseEnv(readText(envPath, '.env.production mobile'));
  if (values.ENV !== 'production') throw new Error('ENV doit valoir production');
  if (values.REALTIME_ENABLED !== 'true') {
    throw new Error('REALTIME_ENABLED doit valoir true');
  }
  validatePublicUrl(values.API_BASE_URL, ['https:']);
  validatePublicUrl(values.WS_BASE_URL, ['wss:']);
  validatePublicUrl(values.LIVEKIT_URL, ['wss:']);
  if (!/^AIza[0-9A-Za-z_-]{35}$/u.test(values.GOOGLE_MAPS_API_KEY ?? '')) {
    throw new Error('GOOGLE_MAPS_API_KEY production invalide');
  }
  return values;
}

function validateBackendProductionEnv(root) {
  const envPath = productionPaths(root).backendEnv;
  const values = parseEnv(readText(envPath, 'environnement backend production'));
  const required = [
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'PUBLIC_URL',
    'LEGAL_ENTITY_NAME',
    'LEGAL_REGISTERED_ADDRESS',
    'LEGAL_JURISDICTION',
    'LEGAL_SUPERVISORY_AUTHORITY',
    'LEGAL_TRANSFER_SAFEGUARDS',
    'PRIVACY_CONTACT_EMAIL',
    'SUPPORT_CONTACT_EMAIL',
    'APPLE_TEAM_ID',
    'ANDROID_APP_SIGNING_SHA256',
    'MEDIA_URL_SIGNING_SECRET',
    'MEDIA_S3_BUCKET',
    'MEDIA_S3_ENDPOINT',
    'MEDIA_S3_ACCESS_KEY',
    'MEDIA_S3_SECRET_KEY',
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'RESEND_API_KEY',
    'MAIL_FROM',
    'CHATHOUSE_API_IMAGE',
  ];
  const missing = required.filter(key => hasPlaceholder(values[key]));
  if (missing.length) {
    throw new Error(`valeurs backend absentes/factices: ${missing.join(', ')}`);
  }
  validatePublicUrl(values.PUBLIC_URL, ['https:']);
  validatePublicUrl(values.LIVEKIT_URL, ['wss:']);
  validatePublicUrl(values.MEDIA_S3_ENDPOINT, ['https:']);
  validateBackendReleaseIdentifiers(values, process.env);
  if (values.PUSH_DISPATCH_ENABLED !== 'true') {
    throw new Error('PUSH_DISPATCH_ENABLED doit valoir true');
  }
  const firebaseCredentialModes =
    Number(values.FIREBASE_USE_ADC === 'true') +
    Number(!hasPlaceholder(values.FIREBASE_SERVICE_ACCOUNT));
  if (firebaseCredentialModes !== 1) {
    throw new Error(
      'Firebase backend exige exactement un mode: FIREBASE_USE_ADC ou compte de service',
    );
  }
  if (values.MEDIA_STORAGE_DRIVER !== 's3') {
    throw new Error('MEDIA_STORAGE_DRIVER doit valoir s3');
  }
  if (!/^AC[0-9A-Fa-f]{32}$/u.test(values.TWILIO_ACCOUNT_SID ?? '')) {
    throw new Error('TWILIO_ACCOUNT_SID production invalide');
  }
  if (!/^\+[1-9]\d{7,14}$/u.test(values.TWILIO_FROM_NUMBER ?? '')) {
    throw new Error('TWILIO_FROM_NUMBER doit être au format E.164');
  }
  if (!/^re_.{7,}$/u.test(values.RESEND_API_KEY ?? '')) {
    throw new Error('RESEND_API_KEY production invalide');
  }
  if (
    !/^ghcr\.io\/[a-z0-9][a-z0-9._/-]+\/api@sha256:[a-f0-9]{64}$/u.test(
      values.CHATHOUSE_API_IMAGE ?? '',
    )
  ) {
    throw new Error('CHATHOUSE_API_IMAGE doit être une référence GHCR immuable par digest');
  }
  return required.length;
}

function loadGradleProperties(root) {
  const configured =
    process.env.GO_LIVE_GRADLE_PROPERTIES ||
    (process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, '.gradle', 'gradle.properties')
      : process.env.HOME
        ? path.join(process.env.HOME, '.gradle', 'gradle.properties')
        : '');
  if (!configured || !existsSync(configured)) return {};
  return parseEnv(readFileSync(configured, 'utf8'));
}

function androidSigning(root) {
  const properties = loadGradleProperties(root);
  const getValue = name =>
    process.env[name] ?? process.env[`ORG_GRADLE_PROJECT_${name}`] ?? properties[name] ?? '';
  const required = [
    'CHATHOUSE_UPLOAD_STORE_FILE',
    'CHATHOUSE_UPLOAD_STORE_PASSWORD',
    'CHATHOUSE_UPLOAD_KEY_ALIAS',
    'CHATHOUSE_UPLOAD_KEY_PASSWORD',
  ];
  const values = Object.fromEntries(required.map(name => [name, getValue(name)]));
  const missing = required.filter(name => !values[name]);
  if (missing.length) throw new Error(`secrets de signature absents: ${missing.join(', ')}`);
  if (String(getValue('CHATHOUSE_ALLOW_DEBUG_RELEASE_SIGNING')).toLowerCase() === 'true') {
    throw new Error('CHATHOUSE_ALLOW_DEBUG_RELEASE_SIGNING=true est interdit');
  }

  const rawStore = values.CHATHOUSE_UPLOAD_STORE_FILE;
  const candidates = path.isAbsolute(rawStore)
    ? [rawStore]
    : [
        path.resolve(root, 'android', 'app', rawStore),
        path.resolve(root, 'android', rawStore),
        path.resolve(root, rawStore),
      ];
  const storePath = candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
  requireFile(storePath, 'keystore Android upload');
  if (
    path.basename(storePath).toLowerCase() === 'debug.keystore' ||
    values.CHATHOUSE_UPLOAD_KEY_ALIAS.toLowerCase() === 'androiddebugkey'
  ) {
    throw new Error('la clé Android debug est interdite');
  }

  const keytool = resolveCommand('keytool');
  const productionCertificate = certificateDerFromPem(
    run(
      keytool,
      [
        '-exportcert',
        '-rfc',
        '-alias',
        values.CHATHOUSE_UPLOAD_KEY_ALIAS,
        '-keystore',
        storePath,
        '-storepass',
        values.CHATHOUSE_UPLOAD_STORE_PASSWORD,
      ],
      { binary: true },
    ),
    'upload Android',
  );
  const productionFingerprint = fingerprint(productionCertificate);

  const debugStore = path.join(root, 'android', 'app', 'debug.keystore');
  if (existsSync(debugStore)) {
    const debugCertificate = certificateDerFromPem(
      run(
        keytool,
        [
          '-exportcert',
          '-rfc',
          '-alias',
          'androiddebugkey',
          '-keystore',
          debugStore,
          '-storepass',
          'android',
        ],
        { binary: true },
      ),
      'debug Android',
    );
    if (productionFingerprint === fingerprint(debugCertificate)) {
      throw new Error('le certificat upload correspond au certificat debug partagé');
    }
  }

  return { ...values, storePath, fingerprint: productionFingerprint };
}

function verifyAndroidArtifact(root, signing, mobileEnv) {
  const aabPath = path.resolve(
    root,
    process.env.GO_LIVE_ANDROID_AAB || path.join('artifacts', 'android-production.aab'),
  );
  requireFile(aabPath, 'AAB Android production');
  if (path.extname(aabPath).toLowerCase() !== '.aab') {
    throw new Error("l'artefact Android doit être un .aab");
  }

  run(resolveCommand('jarsigner'), ['-verify', aabPath]);
  const artifactCertificate = certificateDerFromPem(
    run(resolveCommand('keytool'), ['-printcert', '-jarfile', aabPath, '-rfc'], {
      binary: true,
    }),
    'AAB Android',
  );
  if (fingerprint(artifactCertificate) !== signing.fingerprint) {
    throw new Error("le signataire de l'AAB ne correspond pas à la clé upload");
  }

  const entries = String(run(resolveCommand('jar'), ['tf', aabPath]));
  const abis = new Set(
    [...entries.matchAll(/(?:^|\/)lib\/(armeabi-v7a|arm64-v8a|x86|x86_64)\//gmu)].map(
      match => match[1],
    ),
  );
  if (!abis.has('arm64-v8a')) {
    throw new Error(`AAB sans arm64-v8a (ABI trouvées: ${[...abis].join(', ') || 'aucune'})`);
  }

  const bundleEntry = entries
    .split(/\r?\n/u)
    .find(entry => /(?:^|\/)assets\/index\.android\.bundle$/u.test(entry));
  if (!bundleEntry || bundleEntry.includes('..') || path.isAbsolute(bundleEntry)) {
    throw new Error('bundle JavaScript Android introuvable ou chemin non sûr');
  }
  const extractionDir = mkdtempSync(path.join(tmpdir(), 'chathouse-aab-'));
  try {
    run(resolveCommand('jar'), ['xf', aabPath, bundleEntry], { cwd: extractionDir });
    const bundle = readFileSync(path.join(extractionDir, ...bundleEntry.split('/')));
    for (const forbidden of ['http://127.0.0.1:1', 'ws://127.0.0.1:1']) {
      if (bundle.includes(Buffer.from(forbidden))) {
        throw new Error(`bundle Android contient encore ${forbidden}`);
      }
    }
    for (const expected of [mobileEnv.API_BASE_URL, mobileEnv.LIVEKIT_URL]) {
      if (!bundle.includes(Buffer.from(expected))) {
        throw new Error(`bundle Android ne contient pas l'endpoint production attendu`);
      }
    }
  } finally {
    rmSync(extractionDir, { recursive: true, force: true });
  }

  return `${path.basename(aabPath)}, arm64-v8a, SHA-256 ${hashFile(aabPath).slice(0, 12)}…`;
}

function iosTeamId(root) {
  const projectPath = path.join(root, 'ios', 'ChatHouse.xcodeproj', 'project.pbxproj');
  const project = readText(projectPath, 'projet Xcode');
  const configured =
    process.env.GO_LIVE_IOS_TEAM_ID ||
    project.match(/DEVELOPMENT_TEAM\s*=\s*"?([A-Z0-9]{10})"?;/u)?.[1] ||
    '';
  if (!/^[A-Z0-9]{10}$/u.test(configured)) {
    throw new Error('Team ID Apple absent (GO_LIVE_IOS_TEAM_ID ou DEVELOPMENT_TEAM)');
  }
  if (!project.includes(`PRODUCT_BUNDLE_IDENTIFIER = "${PACKAGE_ID}"`)) {
    throw new Error(`PRODUCT_BUNDLE_IDENTIFIER doit être ${PACKAGE_ID}`);
  }
  const releaseBlock = project.match(
    /\/\* Release \*\/\s*=\s*\{[\s\S]*?buildSettings\s*=\s*\{([\s\S]*?)\};\s*name\s*=\s*Release;/u,
  )?.[1];
  if (!releaseBlock) throw new Error('configuration Xcode Release introuvable');
  if (!/APS_ENVIRONMENT\s*=\s*production;/u.test(releaseBlock)) {
    throw new Error('APS_ENVIRONMENT Release doit être production');
  }
  if (!/TARGETED_DEVICE_FAMILY\s*=\s*"1,2";/u.test(releaseBlock)) {
    throw new Error('la cible Release doit couvrir iPhone et iPad');
  }
  return configured;
}

function plutilExtract(plistPath, keyPath) {
  return String(run('plutil', ['-extract', keyPath, 'raw', '-o', '-', plistPath])).trim();
}

function findFirstDirectory(parent, suffix) {
  const entries = existsSync(parent)
    ? readdirSync(parent).filter(entry => entry.endsWith(suffix))
    : [];
  return entries.length ? path.join(parent, entries[0]) : '';
}

function verifyIosArchive(root, teamId, mobileEnv) {
  const archivePath = path.resolve(
    root,
    process.env.GO_LIVE_IOS_ARCHIVE || path.join('artifacts', 'ChatHouse-production.xcarchive'),
  );
  requireDirectory(archivePath, 'archive iOS production');
  if (!archivePath.toLowerCase().endsWith('.xcarchive')) {
    throw new Error("l'artefact iOS doit être un .xcarchive");
  }

  const archiveInfo = path.join(archivePath, 'Info.plist');
  requireFile(archiveInfo, 'Info.plist de l’archive');
  const archiveBundleId = plutilExtract(archiveInfo, 'ApplicationProperties.CFBundleIdentifier');
  const signingIdentity = plutilExtract(archiveInfo, 'ApplicationProperties.SigningIdentity');
  if (archiveBundleId !== PACKAGE_ID) {
    throw new Error(`bundle ID archive inattendu: ${archiveBundleId}`);
  }
  if (!/(?:Apple Distribution|iPhone Distribution)/u.test(signingIdentity)) {
    throw new Error("l'archive n'utilise pas une identité Apple Distribution");
  }

  const applications = path.join(archivePath, 'Products', 'Applications');
  const appPath = findFirstDirectory(applications, '.app');
  requireDirectory(appPath, 'application signée dans l’archive');
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  const signatureResult = spawnSync('codesign', ['-dvvv', appPath], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  if (signatureResult.error || signatureResult.status !== 0) {
    throw new Error('lecture de la signature codesign impossible');
  }
  const signature = `${signatureResult.stdout ?? ''}\n${signatureResult.stderr ?? ''}`.trim();
  const signatureTeam = signature.match(/TeamIdentifier=([A-Z0-9]{10})/u)?.[1] ?? '';
  if (signatureTeam !== teamId) {
    throw new Error(`Team ID de la signature iOS inattendu: ${signatureTeam || 'absent'}`);
  }

  const appInfo = path.join(appPath, 'Info.plist');
  if (plutilExtract(appInfo, 'CFBundleIdentifier') !== PACKAGE_ID) {
    throw new Error(`CFBundleIdentifier iOS doit être ${PACKAGE_ID}`);
  }
  validateIosFirebaseText(
    readText(path.join(appPath, 'GoogleService-Info.plist'), 'Firebase embarqué dans iOS'),
  );

  const profilePath = path.join(appPath, 'embedded.mobileprovision');
  requireFile(profilePath, 'profil App Store embarqué');
  const profileTemp = path.join(
    mkdtempSync(path.join(tmpdir(), 'chathouse-profile-')),
    'profile.plist',
  );
  try {
    const profile = run('security', ['cms', '-D', '-i', profilePath]);
    writeFileSync(profileTemp, profile, 'utf8');
    const profileTeam = plutilExtract(profileTemp, 'TeamIdentifier.0');
    const applicationId = plutilExtract(profileTemp, 'Entitlements.application-identifier');
    const apsEnvironment = plutilExtract(profileTemp, 'Entitlements.aps-environment');
    const getTaskAllow = plutilExtract(profileTemp, 'Entitlements.get-task-allow');
    if (profileTeam !== teamId || applicationId !== `${teamId}.${PACKAGE_ID}`) {
      throw new Error('profil iOS incompatible avec le Team ID ou le bundle ID');
    }
    if (apsEnvironment !== 'production' || getTaskAllow !== 'false') {
      throw new Error('profil iOS non-distribution (APS/get-task-allow)');
    }
  } finally {
    const profileDir = path.dirname(profileTemp);
    rmSync(profileDir, { recursive: true, force: true });
  }

  const mainBundleCandidates = [
    path.join(appPath, 'main.jsbundle'),
    path.join(appPath, 'index.ios.bundle'),
  ];
  const mainBundle = mainBundleCandidates.find(candidate => existsSync(candidate));
  requireFile(mainBundle, 'bundle JavaScript iOS');
  const bundle = readFileSync(mainBundle);
  for (const forbidden of ['http://127.0.0.1:1', 'ws://127.0.0.1:1']) {
    if (bundle.includes(Buffer.from(forbidden))) {
      throw new Error(`bundle iOS contient encore ${forbidden}`);
    }
  }
  for (const expected of [mobileEnv.API_BASE_URL, mobileEnv.LIVEKIT_URL]) {
    if (!bundle.includes(Buffer.from(expected))) {
      throw new Error(`bundle iOS ne contient pas l'endpoint production attendu`);
    }
  }
  return `${path.basename(archivePath)}, Apple Distribution, Team ${teamId}`;
}

async function fetchText(url, timeoutMs) {
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'ChatHouse-Go-Live-Preflight/1.0' },
    });
  } catch (error) {
    throw new Error(`HTTPS inaccessible (${error instanceof Error ? error.message : error})`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:') throw new Error('redirection finale non HTTPS');
  const text = await response.text();
  if (!text.trim()) throw new Error('réponse vide');
  return { response, text };
}

function normalizeSha(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function assertCleanWorktree(root, reportPath) {
  const args = ['status', '--porcelain=v1', '--untracked-files=all'];
  if (reportPath) {
    const absoluteReport = path.resolve(root, reportPath);
    const relativeReport = path.relative(root, absoluteReport).replaceAll('\\', '/');
    const isSafeGeneratedReport =
      relativeReport.startsWith('artifacts/') &&
      /^go-live-preflight(?:[-_.][A-Za-z0-9]+)*\.json$/u.test(path.posix.basename(relativeReport));
    if (isSafeGeneratedReport) {
      const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', relativeReport], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      if (tracked.status !== 0) {
        args.push('--', '.', `:(top,exclude,literal)${relativeReport}`);
      }
    }
  }
  const status = String(run('git', args, { cwd: root })).trim();
  if (status) {
    const preview = status.split(/\r?\n/u).slice(0, 8).join(', ');
    throw new Error(
      `worktree non propre; HEAD ne représente pas les fichiers contrôlés: ${preview}`,
    );
  }
}

function validateAcceptanceEvidence(data, expectedSha, aabPath) {
  if (normalizeSha(data?.source_sha) !== normalizeSha(expectedSha)) {
    throw new Error('source_sha des preuves ne correspond pas au commit contrôlé');
  }
  const validateRun = (runEvidence, label) => {
    if (runEvidence?.status !== 'passed') throw new Error(`${label} non validé`);
    const testedAt = Date.parse(runEvidence?.tested_at ?? '');
    if (!Number.isFinite(testedAt)) throw new Error(`${label}: tested_at invalide`);
    const maximumAgeDays = Number(process.env.GO_LIVE_EVIDENCE_MAX_AGE_DAYS || 30);
    const age = Date.now() - testedAt;
    if (age < -5 * 60 * 1000 || age > maximumAgeDays * 24 * 60 * 60 * 1000) {
      throw new Error(`${label}: preuve future ou âgée de plus de ${maximumAgeDays} jours`);
    }
    if (hasPlaceholder(runEvidence?.reference)) {
      throw new Error(`${label}: référence de console/rapport absente`);
    }
  };

  validateRun(data?.android?.play_internal, 'Play Internal Testing');
  validateRun(data?.ios?.testflight, 'TestFlight');

  const androidDevices = data?.android?.physical_devices ?? [];
  const iosDevices = data?.ios?.physical_devices ?? [];
  const validDevice = device =>
    device?.status === 'passed' &&
    !hasPlaceholder(device?.model) &&
    !hasPlaceholder(device?.os_version);
  if (!androidDevices.some(validDevice)) {
    throw new Error('aucun test Android physique validé');
  }
  if (!iosDevices.some(device => validDevice(device) && device.family === 'iphone')) {
    throw new Error('aucun test iPhone physique validé');
  }
  if (!iosDevices.some(device => validDevice(device) && device.family === 'ipad')) {
    throw new Error('aucun test iPad physique validé');
  }

  requireFile(aabPath, 'AAB lié aux preuves Play/Internal Testing');
  const expectedHash = normalizeSha(data?.android?.artifact_sha256);
  if (!/^[a-f0-9]{64}$/u.test(expectedHash) || expectedHash !== hashFile(aabPath)) {
    throw new Error("le SHA-256 de l'AAB ne correspond pas à la preuve Play");
  }
  return 'Play Internal, TestFlight, Android, iPhone et iPad validés';
}

async function runPreflight(options) {
  const reporter = new Reporter(options);
  const root = options.root;
  const selected = scope => options.scopes.includes(scope);
  const context = {
    mobileEnv: null,
    signing: null,
    iosTeam: null,
  };

  if (selected('source')) {
    await reporter.check('source', 'revision', () => {
      const revision = String(run('git', ['rev-parse', 'HEAD'], { cwd: root })).trim();
      if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error('SHA Git HEAD invalide');
      reporter.revision = revision;
      const expected = normalizeSha(process.env.GO_LIVE_EXPECTED_SHA);
      if (expected && revision !== expected) {
        throw new Error(`HEAD ${revision} différent du SHA attendu ${expected}`);
      }
      assertCleanWorktree(root, options.reportPath);
      return `HEAD ${revision}`;
    });
  } else {
    try {
      reporter.revision = String(run('git', ['rev-parse', 'HEAD'], { cwd: root })).trim();
    } catch {
      reporter.revision = normalizeSha(process.env.GO_LIVE_EXPECTED_SHA) || null;
    }
  }

  if (selected('production')) {
    await reporter.check('production', 'mobile-env', () => {
      context.mobileEnv = loadMobileEnv(root);
      return '.env.production réel, HTTPS/WSS et temps réel activé';
    });
    await reporter.check('production', 'backend-env', () => {
      const count = validateBackendProductionEnv(root);
      return `${count} paramètres backend critiques présents`;
    });
    await reporter.check('production', 'firebase-android', () => {
      const filePath = productionPaths(root).androidFirebase;
      const data = JSON.parse(readText(filePath, 'Firebase Android production'));
      return `projet ${validateAndroidFirebaseData(data)}`;
    });
    await reporter.check('production', 'firebase-ios', () => {
      const filePath = productionPaths(root).iosFirebase;
      return `projet ${validateIosFirebaseText(readText(filePath, 'Firebase iOS production'))}`;
    });
  }

  if (selected('android')) {
    await reporter.check('android', 'release-guards', () => {
      const gradle = readText(
        path.join(root, 'android', 'app', 'build.gradle'),
        'build.gradle Android',
      );
      for (const required of [
        'validateProductionReleaseConfiguration',
        'CHATHOUSE_ALLOW_DEBUG_RELEASE_SIGNING',
        "ENVFILE') != '.env.production",
        "productionEnv['REALTIME_ENABLED'] != 'true'",
      ]) {
        if (!gradle.includes(required)) throw new Error(`garde Android absent: ${required}`);
      }
      const architectures = readText(
        path.join(root, 'android', 'gradle.properties'),
        'gradle.properties Android',
      );
      if (!/reactNativeArchitectures=.*arm64-v8a/u.test(architectures)) {
        throw new Error('arm64-v8a absent des architectures Android par défaut');
      }
      return 'garde production et arm64-v8a présents';
    });
    await reporter.check('android', 'upload-key', () => {
      context.signing = androidSigning(root);
      return `certificat upload SHA-256 ${context.signing.fingerprint.slice(0, 12)}…`;
    });
    await reporter.check('android', 'signed-aab', () => {
      const mobileEnv = context.mobileEnv ?? loadMobileEnv(root);
      const signing = context.signing ?? androidSigning(root);
      return verifyAndroidArtifact(root, signing, mobileEnv);
    });
  }

  if (selected('ios')) {
    await reporter.check('ios', 'release-config', () => {
      context.iosTeam = iosTeamId(root);
      const bundleScript = readText(
        path.join(root, 'ios', 'scripts', 'bundle-react-native.sh'),
        'garde de bundle iOS',
      );
      if (
        !bundleScript.includes('iOS device Release builds require ENVFILE=.env.production') ||
        !bundleScript.includes('validate_firebase_plist')
      ) {
        throw new Error('garde production iOS incomplet');
      }
      return `Release production, iPhone/iPad, Team ${context.iosTeam}`;
    });
    await reporter.check('ios', 'signed-archive', () => {
      const mobileEnv = context.mobileEnv ?? loadMobileEnv(root);
      const teamId = context.iosTeam ?? iosTeamId(root);
      return verifyIosArchive(root, teamId, mobileEnv);
    });
  }

  if (selected('network')) {
    let mobileEnv;
    try {
      mobileEnv = context.mobileEnv ?? loadMobileEnv(root);
    } catch {
      mobileEnv = {};
    }
    const endpoints = buildPublicEndpoints(mobileEnv, process.env);

    const hosts = new Set();
    for (const [label, rawUrl] of Object.entries(endpoints)) {
      await reporter.check('network', `url-${label}`, () => {
        const url = validatePublicUrl(rawUrl, ['https:']);
        hosts.add(url.hostname);
        return url.toString();
      });
    }
    for (const hostname of hosts) {
      await reporter.check('network', `dns-${hostname}`, async () => {
        const addresses = await dns.lookup(hostname, { all: true });
        if (!addresses.length) throw new Error('aucune adresse DNS');
        return addresses.map(item => item.address).join(', ');
      });
    }
    for (const [label, rawUrl] of Object.entries(endpoints)) {
      await reporter.check('network', `https-${label}`, async () => {
        const { response, text } = await fetchText(rawUrl, options.timeoutMs);
        if (['privacy', 'account_deletion', 'support'].includes(label)) {
          const reasons = legalDraftReasons(text);
          if (reasons.length) throw new Error(`contenu public non final: ${reasons.join(', ')}`);
        }
        return `HTTP ${response.status}, ${text.length} octets`;
      });
    }

    await reporter.check('network', 'android-app-links', async () => {
      const appOrigin = new URL(endpoints.app).origin;
      const { text } = await fetchText(
        `${appOrigin}/.well-known/assetlinks.json`,
        options.timeoutMs,
      );
      const statements = JSON.parse(text);
      if (!Array.isArray(statements)) {
        throw new Error('assetlinks.json doit contenir un tableau JSON');
      }
      const statement = statements.find(item => item?.target?.package_name === PACKAGE_ID);
      if (!statement) throw new Error(`association ${PACKAGE_ID} absente`);
      const configuredFingerprint = normalizeFingerprint(
        process.env.GO_LIVE_ANDROID_APP_SIGNING_SHA256,
      );
      if (!/^[A-F0-9]{64}$/u.test(configuredFingerprint)) {
        throw new Error('GO_LIVE_ANDROID_APP_SIGNING_SHA256 absent/invalide');
      }
      const published = (statement.target?.sha256_cert_fingerprints ?? []).map(
        normalizeFingerprint,
      );
      if (!published.includes(configuredFingerprint)) {
        throw new Error('empreinte Play App Signing absente de assetlinks.json');
      }
      return `package ${PACKAGE_ID} et empreinte Play associés`;
    });

    await reporter.check('network', 'ios-universal-links', async () => {
      const appOrigin = new URL(endpoints.app).origin;
      const { text } = await fetchText(
        `${appOrigin}/.well-known/apple-app-site-association`,
        options.timeoutMs,
      );
      const association = JSON.parse(text);
      const teamId = context.iosTeam ?? iosTeamId(root);
      const expectedAppId = `${teamId}.${PACKAGE_ID}`;
      const rawDetails = association?.applinks?.details ?? [];
      const appIds = Array.isArray(rawDetails)
        ? rawDetails.flatMap(item =>
            Array.isArray(item?.appIDs) ? item.appIDs : item?.appID ? [item.appID] : [],
          )
        : Object.keys(rawDetails);
      if (!appIds.includes(expectedAppId)) {
        throw new Error(`association ${expectedAppId} absente`);
      }
      return `application ${expectedAppId} associée`;
    });
  }

  if (selected('legal')) {
    const legalFiles = [
      ['privacy-policy', path.join(root, 'docs', 'legal', 'PRIVACY-POLICY.md')],
      ['eula', path.join(root, 'docs', 'legal', 'EULA.md')],
      ['store-listing', path.join(root, 'docs', 'store', 'listing.md')],
      ['apple-privacy', path.join(root, 'docs', 'store', 'apple-app-privacy.md')],
      ['google-data-safety', path.join(root, 'docs', 'store', 'google-play-data-safety.md')],
    ];
    for (const [id, filePath] of legalFiles) {
      await reporter.check('legal', id, () => {
        const text = readText(filePath, id);
        const reasons = legalDraftReasons(text);
        if (reasons.length) throw new Error(reasons.join(', '));
        return 'document final sans placeholder ni mention de brouillon';
      });
    }
    await reporter.check('legal', 'store-urls', () => {
      const listing = readText(path.join(root, 'docs', 'store', 'listing.md'), 'fiche stores');
      const urls = [...listing.matchAll(/https:\/\/[^\s)`]+/gu)].map(match => match[0]);
      const required = ['/support', '/privacy', '/account-deletion'];
      for (const suffix of required) {
        const matching = urls.find(url => new URL(url).pathname.endsWith(suffix));
        if (!matching) throw new Error(`URL ${suffix} absente de la fiche stores`);
        validatePublicUrl(matching, ['https:']);
      }
      return 'support, confidentialité et suppression de compte renseignés';
    });
  }

  if (selected('evidence')) {
    await reporter.check('evidence', 'stores-and-devices', () => {
      const evidencePath = path.resolve(
        root,
        process.env.GO_LIVE_STORE_EVIDENCE || path.join('artifacts', 'go-live-evidence.json'),
      );
      const data = JSON.parse(readText(evidencePath, 'preuves stores/appareils'));
      const expectedSha = normalizeSha(process.env.GO_LIVE_EXPECTED_SHA) || reporter.revision;
      if (!expectedSha) throw new Error('SHA source attendu introuvable');
      const aabPath = path.resolve(
        root,
        process.env.GO_LIVE_ANDROID_AAB || path.join('artifacts', 'android-production.aab'),
      );
      return validateAcceptanceEvidence(data, expectedSha, aabPath);
    });
  }

  return reporter;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (!options) return 0;
  } catch (error) {
    console.error(`Erreur de paramètres: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
  const reporter = await runPreflight(options);
  return reporter.printAndWrite();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
