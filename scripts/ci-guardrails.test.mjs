import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const mobileStoreWorkflow = readFileSync('.github/workflows/mobile-store-artifacts.yml', 'utf8');
const productionWorkflow = readFileSync('.github/workflows/cd-production.yml', 'utf8');
const rollbackWorkflow = readFileSync('.github/workflows/rollback.yml', 'utf8');
const goLivePreflightWorkflow = readFileSync('.github/workflows/go-live-preflight.yml', 'utf8');
const environmentDesiredState = readFileSync('.github/environments/staging.yml', 'utf8');
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
const seedScript = readFileSync('backend/scripts/seed.ts', 'utf8');
const seedApiSuite = readFileSync('backend/tests/seed-api.test.ts', 'utf8');
const seedSocketSuite = readFileSync('backend/tests/seed-socket.test.ts', 'utf8');
const jestLifecycleSetup = readFileSync('backend/tests/setup.retry.ts', 'utf8');

function namedMobileStoreStep(name) {
  const marker = `      - name: ${name}`;
  const start = mobileStoreWorkflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing mobile-store workflow step: ${name}`);
  const next = mobileStoreWorkflow.indexOf('\n      - name:', start + marker.length);
  return mobileStoreWorkflow.slice(start, next === -1 ? undefined : next);
}

function namedGoLiveStep(name) {
  const marker = `      - name: ${name}`;
  const start = goLivePreflightWorkflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing Go-Live workflow step: ${name}`);
  const next = goLivePreflightWorkflow.indexOf('\n      - name:', start + marker.length);
  return goLivePreflightWorkflow.slice(start, next === -1 ? undefined : next);
}

function namedProductionStep(name) {
  const marker = `      - name: ${name}`;
  const start = productionWorkflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing production workflow step: ${name}`);
  const next = productionWorkflow.indexOf('\n      - name:', start + marker.length);
  return productionWorkflow.slice(start, next === -1 ? undefined : next);
}

function namedRollbackStep(name) {
  const marker = `      - name: ${name}`;
  const start = rollbackWorkflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing rollback workflow step: ${name}`);
  const next = rollbackWorkflow.indexOf('\n      - name:', start + marker.length);
  return rollbackWorkflow.slice(start, next === -1 ? undefined : next);
}

test('frontend CI remains fail-closed and includes stylesheet validation', () => {
  assert.doesNotMatch(rootPackage.scripts['test:ci'], /--passWithNoTests/u);
  assert.match(workflow, /npm run test:ci/u);
  assert.match(workflow, /npm run stylelint/u);
  assert.match(workflow, /npm run test:dark-theme-contract/u);
  assert.match(rootPackage.scripts.quality, /test:dark-theme-contract/u);
});

test('production Environment policy supports protected manual operations without weakening CD', () => {
  const productionPolicyStart = environmentDesiredState.indexOf('# PRODUCTION environment');
  assert.notEqual(productionPolicyStart, -1, 'Missing documented production Environment policy');
  const productionPolicy = environmentDesiredState.slice(productionPolicyStart);

  assert.match(productionPolicy, /deployment_branch_policy: custom patterns allowing BOTH:/u);
  assert.match(productionPolicy, /^#       - main$/mu);
  assert.match(productionPolicy, /^#       - 'v\*\.\*\.\*'$/mu);
  assert.match(productionPolicy, /mobile-signing, Go-Live preflight/u);
  assert.match(productionPolicy, /emergency rollback workflows/u);
  assert.match(
    productionWorkflow,
    /Release tag must be exactly vMAJOR\.MINOR\.PATCH with no leading zero/u,
  );
  assert.match(
    productionWorkflow,
    /\^v\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\$/u,
  );

  const productionConsumers = [
    productionWorkflow,
    rollbackWorkflow,
    mobileStoreWorkflow,
    goLivePreflightWorkflow,
  ];
  const referencedNames = pattern =>
    new Set(
      productionConsumers.flatMap(source => [...source.matchAll(pattern)].map(match => match[1])),
    );
  const productionSecrets = referencedNames(/secrets\.([A-Z0-9_]+)/gu);
  const productionVariables = referencedNames(/vars\.([A-Z0-9_]+)/gu);

  // Rollback contains both environment branches in one expression. Staging
  // credentials are documented in the real staging block above, not repeated
  // in the commented production desired-state.
  for (const name of [...productionSecrets].filter(value => !value.startsWith('STAGING_'))) {
    assert.match(productionPolicy, new RegExp(`\\b${name}\\b`, 'u'), `${name} is undocumented`);
  }
  for (const name of productionVariables) {
    assert.match(productionPolicy, new RegExp(`\\b${name}\\b`, 'u'), `${name} is undocumented`);
  }
  assert.match(productionPolicy, /repository_or_organization_secrets:/u);
  assert.match(productionPolicy, /notification job has no `environment: production`/u);
});

test('production accepts only exact successful main staging attestations, including manual cutovers', () => {
  const resolver = namedProductionStep('Find a successful staging run for this exact commit');
  assert.match(resolver, /\.head_sha == \$sha/u);
  assert.match(resolver, /\.head_branch == "main"/u);
  assert.match(resolver, /and \(\.event == "push" or \.event == "workflow_dispatch"\)/u);
  assert.match(resolver, /\.conclusion == "success"/u);
  assert.match(resolver, /No successful push or workflow_dispatch staging run on main/u);
});

test('production SemVer OCI tags are immutable digest bindings', () => {
  const promotion = namedProductionStep('Point the release tag at the accepted digest');
  const firstInspect = promotion.indexOf('docker buildx imagetools inspect');
  const create = promotion.indexOf('docker buildx imagetools create');

  assert.ok(firstInspect >= 0, 'Release tag must be inspected before promotion');
  assert.ok(create > firstInspect, 'Release tag must be inspected before it can be created');
  assert.equal(promotion.match(/docker buildx imagetools create/gu)?.length, 1);
  assert.match(promotion, /--prefer-index=false/u);
  assert.match(promotion, /--format '\{\{json \.Manifest\.Digest\}\}'/u);
  assert.match(promotion, /if \[ "\$existing_digest" != "\$digest" \]; then/u);
  assert.match(promotion, /Refusing to reassign immutable release tag/u);
  assert.match(promotion, /Unable to prove whether release tag/u);
  assert.match(promotion, /docker buildx imagetools inspect "\$IMAGE_REF" >\/dev\/null/u);
  assert.match(promotion, /if \[ "\$published_digest" != "\$digest" \]; then/u);
});

test('Actions rollback requires exact successful staging provenance before SSH', () => {
  const inputMarker = '      staging_run_id:';
  const inputStart = rollbackWorkflow.indexOf(inputMarker);
  assert.notEqual(inputStart, -1, 'Missing required staging_run_id input');
  const inputEnd = rollbackWorkflow.indexOf('\n\n', inputStart);
  const input = rollbackWorkflow.slice(inputStart, inputEnd === -1 ? undefined : inputEnd);
  assert.match(input, /^        type: string$/mu);
  assert.match(input, /^        required: true$/mu);
  assert.match(rollbackWorkflow, /^      actions: read$/mu);

  const provenance = namedRollbackStep('Validate staging workflow provenance');
  assert.match(provenance, /\^\[1-9\]\[0-9\]\*\$/u);
  assert.match(provenance, /\/actions\/workflows\/cd-staging\.yml/u);
  assert.match(provenance, /\/actions\/runs\/\$\{STAGING_RUN_ID\}/u);
  assert.match(provenance, /run_workflow_id" != "\$workflow_id"/u);
  assert.match(provenance, /workflow_path" != '\.github\/workflows\/cd-staging\.yml'/u);
  assert.match(provenance, /run_repository" != "\$REPOSITORY"/u);
  assert.match(provenance, /head_branch" != 'main'/u);
  assert.match(provenance, /run_event" != 'push'/u);
  assert.match(provenance, /run_event" != 'workflow_dispatch'/u);
  assert.match(provenance, /run_status" != 'completed'/u);
  assert.match(provenance, /run_conclusion" != 'success'/u);

  const download = namedRollbackStep('Download staging rollback evidence');
  assert.match(download, /actions\/download-artifact@[a-f0-9]{40}/u);
  assert.match(
    download,
    /name: staging-release-candidate-\$\{\{ steps\.provenance\.outputs\.head_sha \}\}/u,
  );
  assert.match(download, /run-id: \$\{\{ inputs\.staging_run_id \}\}/u);

  const binding = namedRollbackStep('Bind rollback digest to staging evidence');
  for (const field of [
    'schema_version',
    'repository',
    'source_sha',
    'image_ref',
    'staging_workflow_run_id',
    'staging_workflow_run_attempt',
  ]) {
    assert.match(binding, new RegExp(`\\.${field}\\b`, 'u'));
  }
  assert.match(binding, /schema_version" != '1'/u);
  assert.match(binding, /repository" != "\$EXPECTED_REPOSITORY"/u);
  assert.match(binding, /source_sha" != "\$EXPECTED_SOURCE_SHA"/u);
  assert.match(binding, /run_id" != "\$EXPECTED_RUN_ID"/u);
  assert.match(binding, /run_attempt" != "\$EXPECTED_RUN_ATTEMPT"/u);
  assert.match(binding, /image_ref" != "\$EXPECTED_IMAGE_REF"/u);

  const provenanceIndex = rollbackWorkflow.indexOf('Validate staging workflow provenance');
  const bindingIndex = rollbackWorkflow.indexOf('Bind rollback digest to staging evidence');
  const sshIndex = rollbackWorkflow.indexOf('Activate rollback target and verify health');
  assert.ok(provenanceIndex >= 0 && provenanceIndex < bindingIndex && bindingIndex < sshIndex);
});

test('CI exercises operational shell, backup, restore and Compose contracts', () => {
  assert.match(workflow, /shellcheck --severity=warning/u);
  assert.match(workflow, /bash scripts\/backup\/test_backup\.sh/u);
  assert.match(workflow, /bash scripts\/backup\/test_pg_restore\.sh/u);
  assert.match(workflow, /docker-compose\.yml config --quiet/u);
  assert.match(workflow, /docker-compose\.test\.yml config --quiet/u);
  assert.match(workflow, /docker-compose\.apk\.yml config --quiet/u);
});

test('CI runs deterministic seeded API and Socket smoke tests in an isolated database', () => {
  assert.match(workflow, /^  backend-seeded-smoke:/mu);
  assert.match(workflow, /POSTGRES_DB: chathouse_seed_test/u);
  assert.match(workflow, /SEED_RANDOM_SEED: '20260815'/u);
  assert.match(workflow, /npm run test:seeded -- --testTimeout=60000/u);
});

test('seeded suites and Jest retries remain deterministic and fail-closed', () => {
  assert.match(seedScript, /faker\.seed\(RANDOM_SEED\)/u);
  assert.match(seedScript, /faker\.setDefaultRefDate\(SEED_REFERENCE_DATE\)/u);
  assert.doesNotMatch(seedScript, /Math\.random\(\)/u);
  assert.doesNotMatch(seedApiSuite, /return\s*;/u);
  assert.doesNotMatch(seedSocketSuite, /return\s*;/u);
  assert.doesNotMatch(seedSocketSuite, /catch\s*\{[^}]*Timeout is acceptable/su);
  assert.match(jestLifecycleSetup, /if \(isIntegrationTestPath\(testPath\)\)/u);
});

test('iOS MARKETING_VERSION accepts exactly three dot-separated integers', () => {
  const patternSource = mobileStoreWorkflow.match(/\[\[ "\$VERSION_NAME" =~ ([^\s]+) \]\]/u)?.[1];
  assert.ok(patternSource, 'The release workflow must validate VERSION_NAME');

  const versionPattern = new RegExp(patternSource, 'u');
  for (const valid of ['0.0.1', '1.0.0', '123.45.6']) {
    assert.equal(versionPattern.test(valid), true, `${valid} should be accepted`);
  }
  for (const invalid of [
    '1',
    '1.2',
    '1.2.3.4',
    '1.2.3-beta',
    '1.2.3+build',
    'v1.2.3',
    ' 1.2.3',
    '1.2.3 ',
  ]) {
    assert.equal(versionPattern.test(invalid), false, `${invalid} should be rejected`);
  }
  assert.match(mobileStoreWorkflow, /MARKETING_VERSION="\$VERSION_NAME"/u);
});

test('iOS release dependencies are installed only from committed lockfiles', () => {
  const lockfileStep = namedMobileStoreStep('Require committed Ruby and CocoaPods lockfiles');
  assert.match(lockfileStep, /for lockfile in Gemfile\.lock ios\/Podfile\.lock/u);
  assert.match(lockfileStep, /\[ -s "\$lockfile" \] \|\|/u);
  assert.match(lockfileStep, /Generate and review it on macOS/u);

  const installStep = namedMobileStoreStep('Install JavaScript, Ruby and CocoaPods dependencies');
  assert.match(installStep, /set -euo pipefail/u);
  assert.match(installStep, /bundle config set --local deployment 'true'/u);
  assert.match(installStep, /bundle install/u);
  assert.match(installStep, /bundle exec pod install --project-directory=ios --deployment/u);
  assert.doesNotMatch(installStep, /--repo-update/u);
});

test('iOS signing rejects every non-App-Store-Connect provisioning profile class', () => {
  const importStep = namedMobileStoreStep('Import Apple distribution identity and profile');
  assert.match(importStep, /Print :Entitlements:beta-reports-active/u);
  assert.match(importStep, /\[ "\$beta_reports_active" = true \]/u);
  assert.match(importStep, /Print :ProvisionedDevices/u);
  assert.match(importStep, /Print :ProvisionsAllDevices/u);
  assert.doesNotMatch(importStep, /beta-reports-active[^\n]*\|\| true/u);

  const verificationStep = namedMobileStoreStep(
    'Verify and package the signed App Store Connect artifacts',
  );
  assert.match(verificationStep, /verify_app_store_connect_profile\(\)/u);
  assert.match(verificationStep, /Print :Entitlements:beta-reports-active/u);
  assert.match(verificationStep, /Print :ProvisionedDevices/u);
  assert.match(verificationStep, /Print :ProvisionsAllDevices/u);
  assert.doesNotMatch(verificationStep, /beta-reports-active[^\n]*\|\| true/u);
  assert.match(
    verificationStep,
    /verify_app_store_connect_profile "\$embedded_plist" "Signed archive"/u,
  );
  assert.match(
    verificationStep,
    /verify_app_store_connect_profile "\$exported_plist" "Exported IPA"/u,
  );
});

test('iOS release export is fail-closed and produces a verified App Store Connect IPA', () => {
  const exportStep = namedMobileStoreStep('Export an App Store Connect IPA');
  assert.match(exportStep, /method: "app-store-connect"/u);
  assert.match(exportStep, /destination: "export"/u);
  assert.match(exportStep, /signingStyle: "manual"/u);
  assert.match(exportStep, /"com\.chathouse\.app": \$profile_name/u);
  assert.match(exportStep, /xcodebuild -exportArchive/u);
  assert.match(exportStep, /-archivePath "\$archive_path"/u);
  assert.match(exportStep, /-exportPath "\$export_path"/u);
  assert.match(exportStep, /-exportOptionsPlist "\$export_options_plist"/u);
  assert.match(exportStep, /ipa_files=\("\$export_path"\/\*\.ipa\)/u);
  assert.match(exportStep, /\$\{#ipa_files\[@\]\} != 1/u);
  assert.match(exportStep, /\[ -s "\$ipa_path" \] \|\|/u);
  assert.match(exportStep, /unzip -tq "\$ipa_path"/u);
  assert.doesNotMatch(exportStep, /continue-on-error: true/u);
  assert.doesNotMatch(exportStep, /\|\| true/u);

  const verificationStep = namedMobileStoreStep(
    'Verify and package the signed App Store Connect artifacts',
  );
  assert.match(verificationStep, /ditto -x -k "\$ipa_path"/u);
  assert.match(verificationStep, /codesign --verify --deep --strict "\$exported_app"/u);
  assert.match(verificationStep, /Print :CFBundleIdentifier/u);
  assert.match(verificationStep, /Print :CFBundleShortVersionString/u);
  assert.match(verificationStep, /Print :CFBundleVersion/u);
  assert.match(verificationStep, /cp "\$ipa_path" artifacts\/ChatHouse\.ipa/u);
  assert.match(verificationStep, /ipa_sha256/u);
  assert.match(mobileStoreWorkflow, /artifacts\/ChatHouse\.ipa/u);
  assert.match(mobileStoreWorkflow, /if-no-files-found: error/u);
});

test('Go-Live accepts only the paired artifacts from one protected mobile workflow run', () => {
  const provenanceStep = namedGoLiveStep('Require successful artifact runs for this exact commit');
  assert.match(provenanceStep, /\[ "\$ANDROID_RUN_ID" != "\$IOS_RUN_ID" \]/u);
  assert.match(provenanceStep, /ANDROID_ARTIFACT_NAME" != android-production-aab/u);
  assert.match(provenanceStep, /IOS_ARTIFACT_NAME" != ios-production-xcarchive/u);
  assert.match(provenanceStep, /\.repository\.full_name/u);
  assert.match(provenanceStep, /\.head_sha/u);
  assert.match(provenanceStep, /\.conclusion/u);
  assert.match(provenanceStep, /\.event/u);
  assert.match(provenanceStep, /\.head_branch/u);
  assert.match(provenanceStep, /\.workflow_id/u);
  assert.match(provenanceStep, /workflow_id" =~ \^\[1-9\]\[0-9\]\*\$/u);
  assert.match(
    provenanceStep,
    /gh api "\/repos\/\$\{REPOSITORY\}\/actions\/workflows\/\$\{workflow_id\}"/u,
  );
  assert.match(provenanceStep, /workflow_path="\$\(jq -r '\.path \/\/ empty' <<< "\$workflow"\)"/u);
  assert.match(provenanceStep, /run_event" != workflow_dispatch/u);
  assert.match(provenanceStep, /run_head_branch" != main/u);
  assert.match(
    provenanceStep,
    /workflow_path" != \.github\/workflows\/mobile-store-artifacts\.yml/u,
  );
  assert.doesNotMatch(provenanceStep, /run_workflow_path/u);
  assert.match(provenanceStep, /validate_run "Android and iOS" "\$ANDROID_RUN_ID"/u);
  assert.doesNotMatch(provenanceStep, /validate_run iOS/u);
});

test('Go-Live locates exactly one AAB, xcarchive tarball, IPA and extracted archive', () => {
  const locateStep = namedGoLiveStep('Locate downloaded artifacts');
  for (const counter of [
    'android_aab_count',
    'ios_tar_count',
    'ios_ipa_count',
    'ios_archive_count',
  ]) {
    assert.match(locateStep, new RegExp(`"\\$${counter}" -ne 1`, 'u'));
  }
  assert.match(locateStep, /find[^\n]*'\*\.aab' -print0/u);
  assert.match(locateStep, /find[^\n]*'\*\.ipa' -print0/u);
  assert.match(locateStep, /tar -tzf "\$ios_tar"/u);
  assert.match(locateStep, /\(\^\/\|\(\^\|\/\)\\\.\\\.\(\/\|\$\)\|\\\\\)/u);
  assert.match(locateStep, /GO_LIVE_IOS_ARCHIVE_TARBALL=\$\{ios_tar\}/u);
  assert.match(locateStep, /GO_LIVE_IOS_IPA=\$\{ios_ipa\}/u);
  assert.doesNotMatch(locateStep, /-print -quit/u);
});
