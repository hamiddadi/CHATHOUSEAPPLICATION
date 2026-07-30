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
import { inflateRawSync } from 'node:zlib';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const PACKAGE_ID = 'com.chathouse.app';
const DEFAULT_SCOPES = ['source', 'production', 'android', 'ios', 'network', 'legal', 'evidence'];
const ALLOWED_SCOPES = [...DEFAULT_SCOPES, 'native'];
const PLACEHOLDER_PATTERN =
  /(?:change[_ -]?me|placeholder|replace[-_. ]?with|your[-_. ]?project|example\.(?:com|net|org|test|invalid)|\b(?:todo|tbd|unknown|not published|pending confirmation)\b|__[A-Za-z0-9][A-Za-z0-9_-]*__|\[(?:publication date|full registered|complete registered|company registration|legal entity|registered address|address|authority|confirm|jurisdiction|governing|competent courts|operated|verified|insert|list every|adequacy|dpo|representative|name\/role|…|\.\.\.)[^\]]*\])/i;
const DRAFT_PATTERN =
  /(?:not publishable(?:\s+as[- ]is|\s+yet)?|release blocker|working (?:draft|inventory)|draft legal copy|must resolve before submission|fill every .*placeholder|pas encore publiable|blocage (?:de |pour la )?mise en production|\bbrouillon\b|\b(?:todo|tbd)\b)/i;

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
    privacy_fr: overrides.GO_LIVE_PRIVACY_FR_URL || `${apiUrl.origin}/privacy?lang=fr`,
    terms: overrides.GO_LIVE_TERMS_URL || `${apiUrl.origin}/terms`,
    terms_fr: overrides.GO_LIVE_TERMS_FR_URL || `${apiUrl.origin}/terms?lang=fr`,
    community_guidelines:
      overrides.GO_LIVE_COMMUNITY_GUIDELINES_URL || `${apiUrl.origin}/community-guidelines`,
    community_guidelines_fr:
      overrides.GO_LIVE_COMMUNITY_GUIDELINES_FR_URL ||
      `${apiUrl.origin}/community-guidelines?lang=fr`,
    child_safety: overrides.GO_LIVE_CHILD_SAFETY_URL || `${apiUrl.origin}/child-safety`,
    child_safety_fr:
      overrides.GO_LIVE_CHILD_SAFETY_FR_URL || `${apiUrl.origin}/child-safety?lang=fr`,
    account_deletion: overrides.GO_LIVE_ACCOUNT_DELETION_URL || `${apiUrl.origin}/account-deletion`,
    account_deletion_fr:
      overrides.GO_LIVE_ACCOUNT_DELETION_FR_URL || `${apiUrl.origin}/account-deletion?lang=fr`,
    support: overrides.GO_LIVE_SUPPORT_URL || `${apiUrl.origin}/support`,
    support_fr: overrides.GO_LIVE_SUPPORT_FR_URL || `${apiUrl.origin}/support?lang=fr`,
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

const LEGAL_DOCUMENT_IDS = ['privacy', 'terms', 'communityGuidelines', 'childSafety'];

export function validateLegalDocumentAlignment({
  control,
  documentSources,
  storeSources,
  backendMetadataSource,
  mobileMetadataSource,
  mobileVersion,
}) {
  if (!control || typeof control !== 'object' || Array.isArray(control)) {
    throw new Error('document-control.json doit contenir un objet');
  }
  if (control.schemaVersion !== 1) {
    throw new Error('schemaVersion du contrôle juridique doit valoir 1');
  }
  if (!['draft', 'published'].includes(control.status)) {
    throw new Error('status juridique doit valoir draft ou published');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(control.version ?? '')) {
    throw new Error('version juridique canonique invalide');
  }
  if (control.lastReviewedDate !== control.version) {
    throw new Error('lastReviewedDate doit correspondre à la version juridique');
  }
  if (control.effectiveDate !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(control.effectiveDate ?? '')) {
    throw new Error("date d'entrée en vigueur juridique invalide");
  }
  if (
    control.defaultLanguage !== 'en' ||
    !Array.isArray(control.supportedLanguages) ||
    !control.supportedLanguages.includes('en') ||
    !control.supportedLanguages.includes('fr')
  ) {
    throw new Error('les langues juridiques en et fr doivent être déclarées');
  }

  const expectedDocumentPaths = new Set();
  for (const id of LEGAL_DOCUMENT_IDS) {
    const descriptor = control.documents?.[id];
    if (!descriptor || typeof descriptor.route !== 'string') {
      throw new Error(`document juridique ${id} absent du contrôle`);
    }
    for (const language of ['en', 'fr']) {
      const filePath = descriptor.files?.[language];
      if (typeof filePath !== 'string' || !filePath) {
        throw new Error(`fichier ${language} absent pour ${id}`);
      }
      expectedDocumentPaths.add(filePath);
      const source = documentSources?.[filePath];
      if (typeof source !== 'string') {
        throw new Error(`source juridique introuvable: ${filePath}`);
      }
      const versionHeader =
        language === 'fr'
          ? `**Version du document :** \`${control.version}\``
          : `**Document version:** \`${control.version}\``;
      const languageHeader =
        language === 'fr' ? '**Langue :** Français (`fr`)' : '**Language:** English (`en`)';
      if (!source.includes(versionHeader)) {
        throw new Error(`version ${control.version} absente ou divergente dans ${filePath}`);
      }
      if (!source.includes(languageHeader)) {
        throw new Error(`langue ${language} non identifiée dans ${filePath}`);
      }
    }
  }

  if (Object.keys(documentSources ?? {}).length !== expectedDocumentPaths.size) {
    throw new Error('ensemble de sources juridiques différent du manifeste');
  }

  const expectedStorePaths = control.storeInventories;
  if (!Array.isArray(expectedStorePaths) || expectedStorePaths.length !== 3) {
    throw new Error('les trois fiches Store doivent être déclarées');
  }
  for (const filePath of expectedStorePaths) {
    const source = storeSources?.[filePath];
    if (typeof source !== 'string') throw new Error(`fiche Store introuvable: ${filePath}`);
    if (!source.includes(`**Legal document set version:** \`${control.version}\``)) {
      throw new Error(`version juridique divergente dans ${filePath}`);
    }
  }
  if (Object.keys(storeSources ?? {}).length !== expectedStorePaths.length) {
    throw new Error('ensemble de fiches Store différent du manifeste');
  }

  if (
    typeof backendMetadataSource !== 'string' ||
    !backendMetadataSource.includes(`LEGAL_DOCUMENT_FALLBACK_VERSION = '${control.version}'`)
  ) {
    throw new Error('version juridique backend divergente');
  }
  if (
    typeof mobileMetadataSource !== 'string' ||
    !mobileMetadataSource.includes(`LEGAL_DOCUMENT_VERSION ?? '${control.version}'`)
  ) {
    throw new Error('version juridique mobile de secours divergente');
  }
  if (mobileVersion !== undefined && mobileVersion !== control.version) {
    throw new Error(
      `version juridique mobile ${mobileVersion || 'absente'} différente de ${control.version}`,
    );
  }
  return `${expectedDocumentPaths.size} documents, ${expectedStorePaths.length} fiches Store, app et backend alignés sur ${control.version}`;
}

export function validateLegalPublicationControl(control) {
  if (control?.status !== 'published') {
    throw new Error('document-control.json reste en statut draft');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(control.effectiveDate ?? '')) {
    throw new Error("date d'entrée en vigueur publiée absente");
  }
  return `version ${control.version}, entrée en vigueur ${control.effectiveDate}`;
}

export function validateStoreListingMetadata(listing, expectedProductName = 'ChatHouse') {
  const codeValue = label => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return listing.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*\`([^\`]+)\``, 'u'))?.[1] ?? '';
  };
  const appName = codeValue('App name');
  const appleSubtitle = codeValue('Apple subtitle (≤30 chars)');
  const googleShortDescription = codeValue('Google short description (≤80 chars)');
  const appleKeywords = codeValue('Apple keywords (≤100 chars, comma-separated)');
  const packageId = listing.match(/\*\*Bundle ID \/ package:\*\*\s*`([^`]+)`/u)?.[1] ?? '';
  const fullDescription =
    listing.match(/## Full description[^\n]*\n\n```\r?\n([\s\S]*?)\r?\n```/u)?.[1] ?? '';

  if (appName !== expectedProductName) {
    throw new Error(`nom Store ${appName || 'absent'} différent de ${expectedProductName}`);
  }
  if (packageId !== PACKAGE_ID) throw new Error(`package Store doit être ${PACKAGE_ID}`);
  for (const [label, value, maximum] of [
    ['sous-titre Apple', appleSubtitle, 30],
    ['description courte Google', googleShortDescription, 80],
    ['mots-clés Apple', appleKeywords, 100],
    ['description complète', fullDescription, 4000],
  ]) {
    if (!value) throw new Error(`${label} absent`);
    if (value.length > maximum) {
      throw new Error(`${label}: ${value.length} caractères, maximum ${maximum}`);
    }
  }
  return `nom/package alignés; limites ${appleSubtitle.length}/30, ${googleShortDescription.length}/80, ${appleKeywords.length}/100 et ${fullDescription.length}/4000`;
}

function readLegalDocumentControl(root) {
  const filePath = path.join(root, 'docs', 'legal', 'document-control.json');
  let control;
  try {
    control = JSON.parse(readText(filePath, 'contrôle des documents juridiques'));
  } catch (error) {
    throw new Error(
      `document-control.json invalide (${error instanceof Error ? error.message : error})`,
    );
  }
  return control;
}

function pngMetadata(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 45 ||
    !buffer.subarray(0, 8).equals(signature) ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error("l'icône iOS n'est pas un PNG valide");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  let offset = 8;
  let hasTransparencyChunk = false;
  let sawEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (offset + length + 12 > buffer.length) {
      throw new Error("l'icône iOS contient un chunk PNG tronqué");
    }
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'tRNS') hasTransparencyChunk = true;
    offset += length + 12;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new Error("l'icône iOS ne contient pas de fin PNG");
  return {
    width,
    height,
    hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
  };
}

export function validateAndroidNativeConfiguration({
  buildGradle,
  gradleProperties,
  manifest,
  debugManifest,
  debugOptimizedManifest,
  releaseNetworkSecurity,
  debugNetworkSecurity,
  debugOptimizedNetworkSecurity,
}) {
  const failures = [];
  const properties = parseEnv(gradleProperties);
  const architectures = String(properties.reactNativeArchitectures ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  for (const architecture of ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64']) {
    if (!architectures.includes(architecture))
      failures.push(`ABI Android absente: ${architecture}`);
  }
  for (const [key, expected] of [
    ['android.minSdkVersion', '24'],
    ['android.compileSdkVersion', '36'],
    ['android.targetSdkVersion', '36'],
    ['android.enableMinifyInReleaseBuilds', 'true'],
    ['android.enableShrinkResourcesInReleaseBuilds', 'true'],
  ]) {
    if (properties[key] !== expected) failures.push(`${key} doit valoir ${expected}`);
  }

  for (const required of [
    "applicationId = 'com.chathouse.app'",
    'validateProductionReleaseConfiguration',
    "System.getenv('ENVFILE') != '.env.production'",
    "productionEnv['REALTIME_ENABLED'] != 'true'",
    'validateProductionFirebase',
    'validateReleaseSigning',
    'gradle.taskGraph.whenReady',
    'CHATHOUSE_ALLOW_DEBUG_RELEASE_SIGNING',
  ]) {
    if (!buildGradle.includes(required)) failures.push(`garde Gradle absente: ${required}`);
  }

  for (const required of [
    'android:allowBackup="false"',
    'android:fullBackupContent="false"',
    'android:dataExtractionRules="@xml/data_extraction_rules"',
    'android:networkSecurityConfig="@xml/network_security_config"',
    'android.permission.RECORD_AUDIO',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  ]) {
    if (!manifest.includes(required)) failures.push(`manifeste Android incomplet: ${required}`);
  }
  if (/android:usesCleartextTraffic\s*=\s*"true"/u.test(manifest)) {
    failures.push('le manifeste Android main autorise le trafic HTTP clair');
  }
  if (
    !/<intent-filter\b[^>]*android:autoVerify="true"[\s\S]*?<data\b[^>]*android:scheme="https"[^>]*android:host="app\.chathouse\.com"[^>]*\/>[\s\S]*?<\/intent-filter>/u.test(
      manifest,
    )
  ) {
    failures.push('App Links Android autoVerify pour app.chathouse.com absent');
  }
  if (
    /cleartextTrafficPermitted\s*=\s*"true"/u.test(releaseNetworkSecurity) ||
    !/cleartextTrafficPermitted\s*=\s*"false"/u.test(releaseNetworkSecurity)
  ) {
    failures.push('la configuration réseau Android main doit interdire tout HTTP clair');
  }
  for (const [variant, variantManifest, networkSecurity] of [
    ['debug', debugManifest, debugNetworkSecurity],
    ['debugOptimized', debugOptimizedManifest, debugOptimizedNetworkSecurity],
  ]) {
    if (
      !/android:usesCleartextTraffic\s*=\s*"true"/u.test(variantManifest) ||
      !/tools:replace\s*=\s*"android:usesCleartextTraffic"/u.test(variantManifest)
    ) {
      failures.push(
        `le manifeste Android ${variant} doit remplacer explicitement usesCleartextTraffic pour Metro`,
      );
    }
    if (!/cleartextTrafficPermitted\s*=\s*"true"/u.test(networkSecurity)) {
      failures.push(
        `la configuration réseau Android ${variant} doit conserver le support Metro local`,
      );
    }
  }

  if (failures.length) throw new Error(failures.join('; '));
  return `SDK 36, ${architectures.join(', ')}, R8/shrink et réseau Release TLS-only`;
}

export function validateIosNativeConfiguration({
  project,
  infoPlist,
  entitlements,
  privacyManifest,
  iconContents,
  icon,
  placeholderIcon,
  bundleScript,
}) {
  const failures = [];
  const releaseBlock = project.match(
    /\/\* Release \*\/\s*=\s*\{[\s\S]*?buildSettings\s*=\s*\{([\s\S]*?)\};\s*name\s*=\s*Release;/u,
  )?.[1];
  if (!releaseBlock) {
    failures.push('configuration Xcode Release introuvable');
  } else {
    for (const [pattern, message] of [
      [/APS_ENVIRONMENT\s*=\s*production;/u, 'APS_ENVIRONMENT Release doit être production'],
      [
        /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"com\.chathouse\.app";/u,
        `PRODUCT_BUNDLE_IDENTIFIER doit être ${PACKAGE_ID}`,
      ],
      [/TARGETED_DEVICE_FAMILY\s*=\s*"1,2";/u, 'la cible Release doit couvrir iPhone et iPad'],
      [
        /CODE_SIGN_ENTITLEMENTS\s*=\s*ChatHouse\/ChatHouse\.entitlements;/u,
        'les entitlements Release ne sont pas liés',
      ],
      [/CODE_SIGN_STYLE\s*=\s*Automatic;/u, 'CODE_SIGN_STYLE Release doit être Automatic'],
      [
        /ASSETCATALOG_COMPILER_APPICON_NAME\s*=\s*AppIcon;/u,
        "le catalogue d'icône Release n'est pas AppIcon",
      ],
      [
        /CURRENT_PROJECT_VERSION\s*=\s*[1-9]\d*;/u,
        'CURRENT_PROJECT_VERSION Release doit être un entier positif',
      ],
      [
        /MARKETING_VERSION\s*=\s*\d+(?:\.\d+){1,3};/u,
        'MARKETING_VERSION Release doit être explicite',
      ],
      [/SUPPORTED_PLATFORMS\s*=\s*"[^"]*iphoneos[^"]*";/u, 'iphoneos absent de Release'],
    ]) {
      if (!pattern.test(releaseBlock)) failures.push(message);
    }
  }

  for (const required of [
    'PrivacyInfo.xcprivacy in Resources',
    'GoogleService-Info.plist in Resources',
    'scripts/bundle-react-native.sh',
  ]) {
    if (!project.includes(required)) failures.push(`projet Xcode incomplet: ${required}`);
  }
  for (const required of [
    '<key>CFBundleIdentifier</key>',
    '<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>',
    '<string>chathouse</string>',
    '<key>NSLocationWhenInUseUsageDescription</key>',
    '<key>NSMicrophoneUsageDescription</key>',
    '<key>NSPhotoLibraryUsageDescription</key>',
    '<key>NSSpeechRecognitionUsageDescription</key>',
    '<string>audio</string>',
    '<string>remote-notification</string>',
  ]) {
    if (!infoPlist.includes(required)) failures.push(`Info.plist iOS incomplet: ${required}`);
  }
  if (
    !/<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/u.test(infoPlist) ||
    !/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/u.test(infoPlist)
  ) {
    failures.push('ATS ou déclaration de chiffrement iOS incorrecte');
  }
  if (
    !entitlements.includes('<string>$(APS_ENVIRONMENT)</string>') ||
    !entitlements.includes('<string>applinks:app.chathouse.com</string>')
  ) {
    failures.push('Push ou Associated Domains absent des entitlements iOS');
  }
  if (
    !/<key>NSPrivacyTracking<\/key>\s*<false\/>/u.test(privacyManifest) ||
    !privacyManifest.includes('<key>NSPrivacyCollectedDataTypes</key>') ||
    !privacyManifest.includes('<key>NSPrivacyAccessedAPITypes</key>')
  ) {
    failures.push('PrivacyInfo.xcprivacy iOS incomplet');
  }
  for (const diagnosticsType of [
    'NSPrivacyCollectedDataTypeCrashData',
    'NSPrivacyCollectedDataTypePerformanceData',
  ]) {
    const declaration = new RegExp(
      `<string>${diagnosticsType}<\\/string>[\\s\\S]{0,180}<key>NSPrivacyCollectedDataTypeLinked<\\/key>\\s*<true\\/>`,
      'u',
    );
    if (!declaration.test(privacyManifest)) {
      failures.push(`${diagnosticsType} doit rester déclaré comme lié à l'utilisateur`);
    }
  }
  if (
    !bundleScript.includes('iOS device Release builds require ENVFILE=.env.production') ||
    !bundleScript.includes('validate_firebase_plist')
  ) {
    failures.push('garde de bundle iOS production incomplète');
  }

  let iconDefinition;
  try {
    iconDefinition = JSON.parse(iconContents);
  } catch {
    failures.push("Contents.json de l'AppIcon iOS invalide");
  }
  const storeIcon = iconDefinition?.images?.find(
    image =>
      image?.filename === 'AppIcon.png' &&
      image?.idiom === 'universal' &&
      image?.platform === 'ios' &&
      image?.size === '1024x1024',
  );
  if (!storeIcon) failures.push('définition AppIcon iOS 1024x1024 universelle absente');
  try {
    const metadata = pngMetadata(icon);
    if (metadata.width !== 1024 || metadata.height !== 1024) {
      failures.push(`AppIcon iOS doit mesurer 1024x1024 (${metadata.width}x${metadata.height})`);
    }
    if (metadata.hasAlpha) failures.push('AppIcon iOS contient encore un canal alpha');
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (placeholderIcon && icon.equals(placeholderIcon)) {
    failures.push("AppIcon iOS est encore identique à l'asset explicitement marqué PLACEHOLDER");
  }

  if (failures.length) throw new Error(failures.join('; '));
  return 'Release iPhone/iPad, Push, Universal Links, privacy manifest et AppIcon validés';
}

export function validateBackendReleaseIdentifiers(values, requested = {}) {
  if (
    !/^[A-Z0-9]{10}$/u.test(values.APPLE_TEAM_ID ?? '') ||
    /^(?:TESTTEAMID|0{10})$/u.test(values.APPLE_TEAM_ID ?? '')
  ) {
    throw new Error('APPLE_TEAM_ID backend doit contenir 10 caractères alphanumériques');
  }
  const backendAndroidFingerprint = normalizeFingerprint(values.ANDROID_APP_SIGNING_SHA256);
  if (
    !/^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/u.test(values.ANDROID_APP_SIGNING_SHA256 ?? '') ||
    !/^[A-F0-9]{64}$/u.test(backendAndroidFingerprint) ||
    /^0{64}$/u.test(backendAndroidFingerprint)
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

function validateAndroidNativeFiles(root) {
  return validateAndroidNativeConfiguration({
    buildGradle: readText(
      path.join(root, 'android', 'app', 'build.gradle'),
      'build.gradle Android',
    ),
    gradleProperties: readText(
      path.join(root, 'android', 'gradle.properties'),
      'gradle.properties Android',
    ),
    manifest: readText(
      path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      'manifeste Android main',
    ),
    debugManifest: readText(
      path.join(root, 'android', 'app', 'src', 'debug', 'AndroidManifest.xml'),
      'manifeste Android debug',
    ),
    debugOptimizedManifest: readText(
      path.join(root, 'android', 'app', 'src', 'debugOptimized', 'AndroidManifest.xml'),
      'manifeste Android debugOptimized',
    ),
    releaseNetworkSecurity: readText(
      path.join(root, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'),
      'sécurité réseau Android main',
    ),
    debugNetworkSecurity: readText(
      path.join(
        root,
        'android',
        'app',
        'src',
        'debug',
        'res',
        'xml',
        'network_security_config.xml',
      ),
      'sécurité réseau Android debug',
    ),
    debugOptimizedNetworkSecurity: readText(
      path.join(
        root,
        'android',
        'app',
        'src',
        'debugOptimized',
        'res',
        'xml',
        'network_security_config.xml',
      ),
      'sécurité réseau Android debugOptimized',
    ),
  });
}

function validateIosNativeFiles(root) {
  const iconPath = path.join(
    root,
    'ios',
    'ChatHouse',
    'Images.xcassets',
    'AppIcon.appiconset',
    'AppIcon.png',
  );
  const placeholderPath = path.join(root, 'assets', 'icon.png');
  return validateIosNativeConfiguration({
    project: readText(
      path.join(root, 'ios', 'ChatHouse.xcodeproj', 'project.pbxproj'),
      'projet Xcode',
    ),
    infoPlist: readText(path.join(root, 'ios', 'ChatHouse', 'Info.plist'), 'Info.plist iOS'),
    entitlements: readText(
      path.join(root, 'ios', 'ChatHouse', 'ChatHouse.entitlements'),
      'entitlements iOS',
    ),
    privacyManifest: readText(
      path.join(root, 'ios', 'ChatHouse', 'PrivacyInfo.xcprivacy'),
      'privacy manifest iOS',
    ),
    iconContents: readText(
      path.join(root, 'ios', 'ChatHouse', 'Images.xcassets', 'AppIcon.appiconset', 'Contents.json'),
      "catalogue d'icône iOS",
    ),
    icon: readFileSync(requireFile(iconPath, 'AppIcon iOS')),
    placeholderIcon: existsSync(placeholderPath) ? readFileSync(placeholderPath) : null,
    bundleScript: readText(
      path.join(root, 'ios', 'scripts', 'bundle-react-native.sh'),
      'garde de bundle iOS',
    ),
  });
}

function readProtoVarint(buffer, offset, label) {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buffer.length && shift <= 63n) {
    const byte = buffer[cursor];
    cursor += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    shift += 7n;
  }
  throw new Error(`${label}: varint protobuf tronqué ou trop long`);
}

function readProtoFields(buffer, label) {
  if (!Buffer.isBuffer(buffer)) throw new Error(`${label}: contenu protobuf invalide`);
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readProtoVarint(buffer, offset, label);
    offset = key.offset;
    const number = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`${label}: numéro de champ protobuf invalide`);
    }

    if (wireType === 0) {
      const decoded = readProtoVarint(buffer, offset, label);
      fields.push({ number, wireType, value: decoded.value });
      offset = decoded.offset;
      continue;
    }
    if (wireType === 1) {
      if (offset + 8 > buffer.length) throw new Error(`${label}: champ fixed64 tronqué`);
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + 8) });
      offset += 8;
      continue;
    }
    if (wireType === 2) {
      const decodedLength = readProtoVarint(buffer, offset, label);
      offset = decodedLength.offset;
      if (decodedLength.value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${label}: champ protobuf trop grand`);
      }
      const length = Number(decodedLength.value);
      if (offset + length > buffer.length) {
        throw new Error(`${label}: champ protobuf tronqué`);
      }
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + length) });
      offset += length;
      continue;
    }
    if (wireType === 5) {
      if (offset + 4 > buffer.length) throw new Error(`${label}: champ fixed32 tronqué`);
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + 4) });
      offset += 4;
      continue;
    }
    throw new Error(`${label}: type protobuf ${wireType} non pris en charge`);
  }
  return fields;
}

function lastProtoField(fields, number, wireType) {
  return fields.findLast(field => field.number === number && field.wireType === wireType);
}

function requiredProtoBytes(fields, number, label) {
  const field = lastProtoField(fields, number, 2);
  if (!field) throw new Error(`${label}: champ protobuf ${number} absent`);
  return field.value;
}

function protoString(fields, number) {
  const field = lastProtoField(fields, number, 2);
  return field ? field.value.toString('utf8') : '';
}

export function validateAndroidBundlePageAlignment(bundleConfig) {
  const configFields = readProtoFields(bundleConfig, 'BundleConfig.pb');
  const optimizations = readProtoFields(
    requiredProtoBytes(configFields, 2, 'BundleConfig.pb/optimizations'),
    'BundleConfig.pb/optimizations',
  );
  const nativeLibraries = readProtoFields(
    requiredProtoBytes(
      optimizations,
      2,
      'BundleConfig.pb/optimizations/uncompress_native_libraries',
    ),
    'BundleConfig.pb/optimizations/uncompress_native_libraries',
  );
  const enabled = lastProtoField(nativeLibraries, 1, 0)?.value ?? 0n;
  const alignment = lastProtoField(nativeLibraries, 2, 0)?.value ?? 0n;
  const alignmentNames = {
    0: 'PAGE_ALIGNMENT_UNSPECIFIED',
    1: 'PAGE_ALIGNMENT_4K',
    2: 'PAGE_ALIGNMENT_16K',
    3: 'PAGE_ALIGNMENT_64K',
  };
  const alignmentName = alignmentNames[Number(alignment)] ?? `valeur inconnue ${alignment}`;

  if (enabled !== 1n) {
    throw new Error(
      'BundleConfig.pb ne demande pas de bibliothèques natives non compressées dans les APK',
    );
  }
  if (alignment !== 2n && alignment !== 3n) {
    throw new Error(
      `alignement ZIP/page AAB insuffisant: ${alignmentName}; PAGE_ALIGNMENT_16K minimum requis`,
    );
  }
  return alignmentName;
}

function xmlElementFromNode(node, label) {
  const nodeFields = readProtoFields(node, label);
  const element = lastProtoField(nodeFields, 1, 2);
  const text = lastProtoField(nodeFields, 2, 2);
  if (element && text) throw new Error(`${label}: nœud XML protobuf ambigu`);
  return element?.value ?? null;
}

function compiledIntegerFromXmlAttribute(attributeFields, label) {
  const compiledItem = lastProtoField(attributeFields, 6, 2);
  if (!compiledItem) return null;
  const itemFields = readProtoFields(compiledItem.value, `${label}/compiled_item`);
  const primitive = lastProtoField(itemFields, 7, 2);
  if (!primitive) throw new Error(`${label}: valeur compilée non entière`);
  const primitiveFields = readProtoFields(primitive.value, `${label}/compiled_item/primitive`);
  const decimal = lastProtoField(primitiveFields, 6, 0);
  const hexadecimal = lastProtoField(primitiveFields, 7, 0);
  const value = decimal?.value ?? hexadecimal?.value;
  if (value === undefined || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label}: entier compilé absent ou trop grand`);
  }
  return Number(value);
}

export function validateAndroidManifestTargetSdk(manifest, expectedTargetSdk = 36) {
  const rootElementBytes = xmlElementFromNode(manifest, 'base/manifest/AndroidManifest.xml');
  if (!rootElementBytes) {
    throw new Error('base/manifest/AndroidManifest.xml: élément racine absent');
  }
  const rootFields = readProtoFields(
    rootElementBytes,
    'base/manifest/AndroidManifest.xml/manifest',
  );
  if (protoString(rootFields, 3) !== 'manifest') {
    throw new Error("base/manifest/AndroidManifest.xml: racine 'manifest' absente");
  }

  const usesSdkElements = rootFields
    .filter(field => field.number === 5 && field.wireType === 2)
    .map((field, index) =>
      xmlElementFromNode(
        field.value,
        `base/manifest/AndroidManifest.xml/manifest/enfant-${index + 1}`,
      ),
    )
    .filter(Boolean)
    .map(element => readProtoFields(element, 'base/manifest/AndroidManifest.xml/manifest/uses-sdk'))
    .filter(fields => protoString(fields, 3) === 'uses-sdk');
  if (usesSdkElements.length !== 1) {
    throw new Error(
      `base/manifest/AndroidManifest.xml: élément uses-sdk ${
        usesSdkElements.length ? 'dupliqué' : 'absent'
      }`,
    );
  }

  const androidNamespace = 'http://schemas.android.com/apk/res/android';
  const targetAttributes = usesSdkElements[0]
    .filter(field => field.number === 4 && field.wireType === 2)
    .map(field =>
      readProtoFields(field.value, 'base/manifest/AndroidManifest.xml/uses-sdk/@targetSdkVersion'),
    )
    .filter(
      fields =>
        protoString(fields, 1) === androidNamespace &&
        protoString(fields, 2) === 'targetSdkVersion',
    );
  if (targetAttributes.length !== 1) {
    throw new Error(
      `base/manifest/AndroidManifest.xml: android:targetSdkVersion ${
        targetAttributes.length ? 'dupliqué' : 'absent'
      }`,
    );
  }

  const rawValue = protoString(targetAttributes[0], 3);
  const rawTarget = /^\d+$/u.test(rawValue) ? Number(rawValue) : null;
  const compiledTarget = compiledIntegerFromXmlAttribute(
    targetAttributes[0],
    'base/manifest/AndroidManifest.xml/uses-sdk/@targetSdkVersion',
  );
  if (rawTarget === null && compiledTarget === null) {
    throw new Error('base/manifest/AndroidManifest.xml: targetSdkVersion non numérique');
  }
  if (rawTarget !== null && compiledTarget !== null && rawTarget !== compiledTarget) {
    throw new Error(
      `base/manifest/AndroidManifest.xml: targetSdkVersion incohérent (${rawTarget}/${compiledTarget})`,
    );
  }
  const targetSdk = compiledTarget ?? rawTarget;
  if (targetSdk !== expectedTargetSdk) {
    throw new Error(
      `AAB targetSdkVersion ${targetSdk}; targetSdkVersion ${expectedTargetSdk} requis`,
    );
  }
  return targetSdk;
}

function readElfUnsigned(buffer, offset, byteLength, littleEndian, label) {
  if (offset < 0 || offset + byteLength > buffer.length) {
    throw new Error(`${label}: en-tête ELF tronqué`);
  }
  if (byteLength === 2) {
    return BigInt(littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset));
  }
  if (byteLength === 4) {
    return BigInt(littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset));
  }
  return littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
}

export function validateElfLoadAlignment(elf, label = 'bibliothèque native') {
  if (
    !Buffer.isBuffer(elf) ||
    elf.length < 52 ||
    elf[0] !== 0x7f ||
    elf.toString('ascii', 1, 4) !== 'ELF'
  ) {
    throw new Error(`${label}: fichier ELF invalide ou tronqué`);
  }
  const elfClass = elf[4];
  const encoding = elf[5];
  if (elfClass !== 1 && elfClass !== 2) {
    throw new Error(`${label}: classe ELF inconnue ${elfClass}`);
  }
  if (encoding !== 1 && encoding !== 2) {
    throw new Error(`${label}: encodage ELF inconnu ${encoding}`);
  }
  const littleEndian = encoding === 1;
  const expectedHeaderSize = elfClass === 1 ? 52 : 64;
  const expectedProgramHeaderSize = elfClass === 1 ? 32 : 56;
  if (elf.length < expectedHeaderSize) throw new Error(`${label}: en-tête ELF tronqué`);
  const fileType = readElfUnsigned(elf, 16, 2, littleEndian, label);
  if (fileType !== 3n) throw new Error(`${label}: ELF n'est pas une bibliothèque partagée ET_DYN`);

  const programOffset = readElfUnsigned(
    elf,
    elfClass === 1 ? 28 : 32,
    elfClass === 1 ? 4 : 8,
    littleEndian,
    label,
  );
  const programEntrySize = Number(
    readElfUnsigned(elf, elfClass === 1 ? 42 : 54, 2, littleEndian, label),
  );
  const programCount = Number(
    readElfUnsigned(elf, elfClass === 1 ? 44 : 56, 2, littleEndian, label),
  );
  if (programCount === 0 || programCount === 0xffff) {
    throw new Error(`${label}: table des segments ELF absente ou étendue non prise en charge`);
  }
  if (programEntrySize < expectedProgramHeaderSize) {
    throw new Error(`${label}: entrée de segment ELF trop courte`);
  }
  if (programOffset > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label}: offset de segments ELF trop grand`);
  }
  const tableEnd = programOffset + BigInt(programEntrySize) * BigInt(programCount);
  if (tableEnd > BigInt(elf.length)) {
    throw new Error(`${label}: table des segments ELF tronquée`);
  }

  const loadAlignments = [];
  for (let index = 0; index < programCount; index += 1) {
    const offset = Number(programOffset) + index * programEntrySize;
    const type = readElfUnsigned(elf, offset, 4, littleEndian, label);
    if (type !== 1n) continue;
    const fileOffset = readElfUnsigned(
      elf,
      offset + (elfClass === 1 ? 4 : 8),
      elfClass === 1 ? 4 : 8,
      littleEndian,
      label,
    );
    const virtualAddress = readElfUnsigned(
      elf,
      offset + (elfClass === 1 ? 8 : 16),
      elfClass === 1 ? 4 : 8,
      littleEndian,
      label,
    );
    const alignment = readElfUnsigned(
      elf,
      offset + (elfClass === 1 ? 28 : 48),
      elfClass === 1 ? 4 : 8,
      littleEndian,
      label,
    );
    if (alignment < 16384n) {
      throw new Error(
        `${label}: segment ELF LOAD #${index + 1} aligné sur ${alignment} octets (< 16384)`,
      );
    }
    if ((alignment & (alignment - 1n)) !== 0n) {
      throw new Error(
        `${label}: segment ELF LOAD #${index + 1} avec alignement non puissance de deux`,
      );
    }
    if (fileOffset % alignment !== virtualAddress % alignment) {
      throw new Error(`${label}: segment ELF LOAD #${index + 1} avec offsets non congruents`);
    }
    loadAlignments.push(alignment);
  }
  if (!loadAlignments.length) throw new Error(`${label}: aucun segment ELF LOAD`);
  return {
    bits: elfClass === 1 ? 32 : 64,
    loadSegments: loadAlignments.length,
    minimumAlignment: loadAlignments.reduce(
      (minimum, alignment) => (alignment < minimum ? alignment : minimum),
      loadAlignments[0],
    ),
  };
}

function readZipDirectory(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < 22) {
    throw new Error('AAB: archive ZIP invalide ou tronquée');
  }
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      archive.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + archive.readUInt16LE(offset + 20) === archive.length
    ) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('AAB: fin de répertoire ZIP introuvable');

  const disk = archive.readUInt16LE(endOffset + 4);
  const directoryDisk = archive.readUInt16LE(endOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const directorySize = archive.readUInt32LE(endOffset + 12);
  const directoryOffset = archive.readUInt32LE(endOffset + 16);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('AAB: archive ZIP multi-volume interdite');
  }
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('AAB: ZIP64 inattendu pour un artefact mobile');
  }
  if (directoryOffset + directorySize > endOffset) {
    throw new Error('AAB: répertoire ZIP hors limites');
  }

  const entries = [];
  const names = new Set();
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`AAB: entrée ZIP centrale #${index + 1} invalide`);
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compression = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > archive.length) throw new Error('AAB: entrée ZIP centrale tronquée');
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (!name || name.includes('\0')) throw new Error('AAB: nom d’entrée ZIP invalide');
    if (names.has(name)) throw new Error(`AAB: entrée ZIP dupliquée: ${name}`);
    names.add(name);
    entries.push({
      name,
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = nextOffset;
  }
  if (offset > directoryOffset + directorySize) {
    throw new Error('AAB: taille du répertoire ZIP incohérente');
  }
  return entries;
}

function extractZipEntry(archive, entry) {
  if (entry.flags & 1) throw new Error(`AAB: entrée chiffrée interdite: ${entry.name}`);
  const offset = entry.localOffset;
  if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`AAB: en-tête ZIP local invalide: ${entry.name}`);
  }
  const localFlags = archive.readUInt16LE(offset + 6);
  const localCompression = archive.readUInt16LE(offset + 8);
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (
    localFlags !== entry.flags ||
    localCompression !== entry.compression ||
    dataEnd > archive.length
  ) {
    throw new Error(`AAB: métadonnées ZIP incohérentes: ${entry.name}`);
  }
  const localName = archive.toString('utf8', offset + 30, offset + 30 + nameLength);
  if (localName !== entry.name) throw new Error(`AAB: noms ZIP incohérents: ${entry.name}`);

  const compressed = archive.subarray(dataOffset, dataEnd);
  let value;
  if (entry.compression === 0) value = compressed;
  else if (entry.compression === 8) {
    try {
      value = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
    } catch (error) {
      throw new Error(
        `AAB: décompression impossible pour ${entry.name} (${
          error instanceof Error ? error.message : error
        })`,
      );
    }
  } else {
    throw new Error(`AAB: compression ZIP ${entry.compression} non prise en charge: ${entry.name}`);
  }
  if (value.length !== entry.uncompressedSize) {
    throw new Error(`AAB: taille décompressée incohérente: ${entry.name}`);
  }
  return value;
}

function requiredZipEntry(entries, name) {
  const entry = entries.find(candidate => candidate.name === name);
  if (!entry) throw new Error(`AAB: entrée requise absente: ${name}`);
  return entry;
}

export function validateAndroidAab16KbCompatibility(archive, expectedTargetSdk = 36) {
  const entries = readZipDirectory(archive);
  const pageAlignment = validateAndroidBundlePageAlignment(
    extractZipEntry(archive, requiredZipEntry(entries, 'BundleConfig.pb')),
  );
  const targetSdk = validateAndroidManifestTargetSdk(
    extractZipEntry(archive, requiredZipEntry(entries, 'base/manifest/AndroidManifest.xml')),
    expectedTargetSdk,
  );
  const nativeEntries = entries.filter(entry =>
    /^[^/]+\/lib\/(?:armeabi-v7a|arm64-v8a|x86|x86_64)\/[^/]+\.so$/u.test(entry.name),
  );
  for (const entry of nativeEntries) {
    validateElfLoadAlignment(extractZipEntry(archive, entry), entry.name);
  }
  return {
    targetSdk,
    pageAlignment,
    nativeLibraries: nativeEntries.length,
  };
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
          '          native             Contrôles statiques Android/iOS sans secrets ni build',
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

  const invalidScopes = options.scopes.filter(scope => !ALLOWED_SCOPES.includes(scope));
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
  const legalControl = readLegalDocumentControl(root);
  if (values.LEGAL_DOCUMENT_VERSION !== legalControl.version) {
    throw new Error(
      `LEGAL_DOCUMENT_VERSION mobile ${values.LEGAL_DOCUMENT_VERSION || 'absente'} différente de ${legalControl.version}`,
    );
  }
  validateLegalPublicationControl(legalControl);
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
    'LEGAL_REGISTRATION_NUMBER',
    'LEGAL_JURISDICTION',
    'LEGAL_DISPUTE_PROCESS',
    'LEGAL_LIABILITY_TERMS',
    'LEGAL_SUPERVISORY_AUTHORITY',
    'LEGAL_TRANSFER_SAFEGUARDS',
    'LEGAL_DPO_CONTACT',
    'LEGAL_EU_REPRESENTATIVE',
    'LEGAL_DOCUMENT_VERSION',
    'LEGAL_DOCUMENT_EFFECTIVE_DATE',
    'LEGAL_SERVICE_PROVIDERS',
    'LEGAL_PROCESSING_LOCATIONS',
    'LEGAL_LOG_BACKUP_RETENTION',
    'LEGAL_SUPPORT_MODERATION_RETENTION',
    'LEGAL_MODERATION_APPEAL_ROUTE',
    'LEGAL_ADULT_CONTENT_POLICY',
    'LEGAL_CHILD_SAFETY_REPORTING_PROCESS',
    'LEGAL_CONTACT_PHONE',
    'PRIVACY_CONTACT_EMAIL',
    'SUPPORT_CONTACT_EMAIL',
    'SAFETY_CONTACT_EMAIL',
    'CHILD_SAFETY_CONTACT_NAME',
    'CHILD_SAFETY_CONTACT_EMAIL',
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
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.LEGAL_DOCUMENT_VERSION ?? '')) {
    throw new Error('LEGAL_DOCUMENT_VERSION doit être une date ISO revue');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.LEGAL_DOCUMENT_EFFECTIVE_DATE ?? '')) {
    throw new Error('LEGAL_DOCUMENT_EFFECTIVE_DATE doit être une date ISO revue');
  }
  const legalControl = readLegalDocumentControl(root);
  validateLegalPublicationControl(legalControl);
  if (values.LEGAL_DOCUMENT_VERSION !== legalControl.version) {
    throw new Error('LEGAL_DOCUMENT_VERSION backend diffère du contrôle juridique canonique');
  }
  if (values.LEGAL_DOCUMENT_EFFECTIVE_DATE !== legalControl.effectiveDate) {
    throw new Error(
      'LEGAL_DOCUMENT_EFFECTIVE_DATE backend diffère du contrôle juridique canonique',
    );
  }
  if (!/^\+[1-9]\d{7,14}$/u.test(values.LEGAL_CONTACT_PHONE ?? '')) {
    throw new Error('LEGAL_CONTACT_PHONE doit être au format E.164');
  }
  for (const field of [
    'PRIVACY_CONTACT_EMAIL',
    'SUPPORT_CONTACT_EMAIL',
    'SAFETY_CONTACT_EMAIL',
    'CHILD_SAFETY_CONTACT_EMAIL',
  ]) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(values[field] ?? '')) {
      throw new Error(`${field} doit être une adresse e-mail publique valide`);
    }
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

  const compatibility = validateAndroidAab16KbCompatibility(readFileSync(aabPath), 36);
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

  return `${path.basename(aabPath)}, targetSdk ${compatibility.targetSdk}, ${
    compatibility.pageAlignment
  }, ${compatibility.nativeLibraries} ELF 16 KB, arm64-v8a, SHA-256 ${hashFile(aabPath).slice(
    0,
    12,
  )}…`;
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

  if (selected('native')) {
    await reporter.check('native', 'android-source', () => validateAndroidNativeFiles(root));
    await reporter.check('native', 'ios-source', () => validateIosNativeFiles(root));
  }

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
    await reporter.check('android', 'release-guards', () => validateAndroidNativeFiles(root));
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
      const sourceConfiguration = validateIosNativeFiles(root);
      context.iosTeam = iosTeamId(root);
      return `${sourceConfiguration}, Team ${context.iosTeam}`;
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
        if (
          [
            'privacy',
            'privacy_fr',
            'terms',
            'terms_fr',
            'community_guidelines',
            'community_guidelines_fr',
            'child_safety',
            'child_safety_fr',
            'account_deletion',
            'account_deletion_fr',
            'support',
            'support_fr',
          ].includes(label)
        ) {
          const reasons = legalDraftReasons(text);
          if (reasons.length) throw new Error(`contenu public non final: ${reasons.join(', ')}`);
          const expectedLanguage = label.endsWith('_fr') ? 'fr' : 'en';
          if (
            !text.includes(`<html lang="${expectedLanguage}">`) ||
            response.headers.get('content-language') !== expectedLanguage
          ) {
            throw new Error(`page juridique non identifiée en ${expectedLanguage}`);
          }
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
      ['privacy-policy-fr', path.join(root, 'docs', 'legal', 'PRIVACY-POLICY.fr.md')],
      ['eula', path.join(root, 'docs', 'legal', 'EULA.md')],
      ['eula-fr', path.join(root, 'docs', 'legal', 'EULA.fr.md')],
      ['community-guidelines', path.join(root, 'docs', 'legal', 'COMMUNITY-GUIDELINES.md')],
      ['community-guidelines-fr', path.join(root, 'docs', 'legal', 'COMMUNITY-GUIDELINES.fr.md')],
      ['child-safety', path.join(root, 'docs', 'legal', 'CHILD-SAFETY-STANDARDS.md')],
      ['child-safety-fr', path.join(root, 'docs', 'legal', 'CHILD-SAFETY-STANDARDS.fr.md')],
      ['store-listing', path.join(root, 'docs', 'store', 'listing.md')],
      ['apple-privacy', path.join(root, 'docs', 'store', 'apple-app-privacy.md')],
      ['google-data-safety', path.join(root, 'docs', 'store', 'google-play-data-safety.md')],
    ];
    const legalControl = readLegalDocumentControl(root);
    await reporter.check('legal', 'document-version-alignment', () => {
      const documentSources = Object.fromEntries(
        Object.values(legalControl.documents ?? {}).flatMap(descriptor =>
          Object.values(descriptor?.files ?? {}).map(filePath => [
            filePath,
            readText(path.join(root, filePath), filePath),
          ]),
        ),
      );
      const storeSources = Object.fromEntries(
        (legalControl.storeInventories ?? []).map(filePath => [
          filePath,
          readText(path.join(root, filePath), filePath),
        ]),
      );
      return validateLegalDocumentAlignment({
        control: legalControl,
        documentSources,
        storeSources,
        backendMetadataSource: readText(
          path.join(root, 'backend', 'src', 'routes', 'legalDocumentMetadata.ts'),
          'métadonnées juridiques backend',
        ),
        mobileMetadataSource: readText(
          path.join(root, 'src', 'config', 'env.ts'),
          'métadonnées juridiques mobile',
        ),
      });
    });
    await reporter.check('legal', 'document-publication-status', () =>
      validateLegalPublicationControl(legalControl),
    );
    await reporter.check('legal', 'store-metadata-limits', () =>
      validateStoreListingMetadata(
        readText(path.join(root, 'docs', 'store', 'listing.md'), 'fiche stores'),
        legalControl.productName,
      ),
    );
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
      const required = [
        '/support',
        '/privacy',
        '/terms',
        '/community-guidelines',
        '/child-safety',
        '/account-deletion',
      ];
      for (const suffix of required) {
        const english = urls.find(url => {
          const parsed = new URL(url);
          return parsed.pathname.endsWith(suffix) && !parsed.searchParams.has('lang');
        });
        const french = urls.find(url => {
          const parsed = new URL(url);
          return parsed.pathname.endsWith(suffix) && parsed.searchParams.get('lang') === 'fr';
        });
        if (!english) throw new Error(`URL anglaise ${suffix} absente de la fiche stores`);
        if (!french) throw new Error(`URL française ${suffix}?lang=fr absente de la fiche stores`);
        validatePublicUrl(english, ['https:']);
        validatePublicUrl(french, ['https:']);
      }
      return 'URLs anglaises et françaises renseignées pour les six ressources publiques';
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
