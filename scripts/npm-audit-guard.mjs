import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEVERITY = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const CONFIG_PATH = resolve(REPOSITORY_ROOT, 'security/npm-audit-allowlist.json');

const blockingEntries = report =>
  Object.entries(report.vulnerabilities ?? {}).filter(
    ([, vulnerability]) => (SEVERITY[vulnerability.severity] ?? -1) >= SEVERITY.high,
  );

/**
 * Resolve npm's transitive `via: ["package-name"]` graph to advisory URLs.
 * Cycles are ignored per branch, but a high-severity node with no resolvable
 * advisory is returned as `unresolved:<name>` and therefore cannot be allowed.
 */
export const resolveBlockingAdvisories = report => {
  const vulnerabilities = report.vulnerabilities ?? {};

  const visit = (name, ancestors) => {
    if (ancestors.has(name)) return new Set();
    const vulnerability = vulnerabilities[name];
    if (!vulnerability || !Array.isArray(vulnerability.via)) {
      return new Set([`unresolved:${name}`]);
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(name);
    const leaves = new Set();
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        for (const leaf of visit(via, nextAncestors)) leaves.add(leaf);
      } else if (via && typeof via.url === 'string' && via.url.length > 0) {
        leaves.add(via.url);
      } else {
        leaves.add(`unresolved:${name}`);
      }
    }
    if (leaves.size === 0 && vulnerability.via.length === 0) {
      leaves.add(`unresolved:${name}`);
    }
    return leaves;
  };

  const advisories = new Set();
  for (const [name] of blockingEntries(report)) {
    const resolved = visit(name, new Set());
    if (resolved.size === 0) resolved.add(`unresolved:${name}`);
    for (const advisory of resolved) advisories.add(advisory);
  }
  return [...advisories].sort();
};

// Patch files are text and Git may materialize them as CRLF on Windows. Hash a
// canonical LF representation so the same reviewed patch has one fingerprint
// on developer machines and Linux CI, while every substantive byte change
// still invalidates the exception.
export const hashSecurityPatch = contents =>
  createHash('sha256').update(contents.replaceAll('\r\n', '\n')).digest('hex');

const sha256 = file => hashSecurityPatch(readFileSync(file, 'utf8'));

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

const validateException = (exception, report, targetDirectory) => {
  const vulnerability = report.vulnerabilities?.[exception.package];
  if (!vulnerability) {
    throw new Error(`Allowlisted package ${exception.package} is not present in npm audit output`);
  }

  const actualNodes = [...(vulnerability.nodes ?? [])].sort();
  const expectedNodes = [...exception.nodes].sort();
  if (JSON.stringify(actualNodes) !== JSON.stringify(expectedNodes)) {
    throw new Error(
      `${exception.package} moved to unexpected dependency nodes: ${actualNodes.join(', ')}`,
    );
  }

  const lock = readJson(resolve(targetDirectory, 'package-lock.json'));
  for (const node of expectedNodes) {
    const installedVersion = lock.packages?.[node]?.version;
    if (installedVersion !== exception.version) {
      throw new Error(
        `${exception.package} expected ${exception.version} at ${node}, found ${installedVersion ?? 'nothing'}`,
      );
    }
  }

  const expiresAt = Date.parse(`${exception.expiresOn}T23:59:59.999Z`);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    throw new Error(
      `Security exception for ${exception.package} expired on ${exception.expiresOn}`,
    );
  }

  const patchPath = resolve(REPOSITORY_ROOT, exception.patch);
  if (!existsSync(patchPath) || sha256(patchPath) !== exception.patchSha256) {
    throw new Error(`Security patch is missing or changed: ${exception.patch}`);
  }
  const testPath = resolve(REPOSITORY_ROOT, exception.regressionTest);
  if (!existsSync(testPath)) {
    throw new Error(`Security regression test is missing: ${exception.regressionTest}`);
  }
};

const parseArguments = () => {
  const workdirIndex = process.argv.indexOf('--workdir');
  const workdir = workdirIndex >= 0 ? process.argv[workdirIndex + 1] : '.';
  if (!workdir) throw new Error('--workdir requires a path');
  return resolve(REPOSITORY_ROOT, workdir);
};

const runAudit = targetDirectory => {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, ['audit', '--json'], {
    cwd: targetDirectory,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit did not return valid JSON: ${result.stderr || result.stdout}`);
  }
  if (!report.vulnerabilities || report.error) {
    throw new Error(`npm audit failed: ${JSON.stringify(report.error ?? report)}`);
  }
  return report;
};

export const main = () => {
  const targetDirectory = parseArguments();
  const report = runAudit(targetDirectory);
  const blocking = blockingEntries(report);
  if (blocking.length === 0) {
    console.log(`npm audit guard: PASS (${targetDirectory}) - no high/critical findings`);
    return;
  }

  const config = readJson(CONFIG_PATH);
  const exceptions = config.exceptions ?? [];
  const allowedAdvisories = new Set(exceptions.flatMap(item => item.advisories));
  const foundAdvisories = resolveBlockingAdvisories(report);
  const unexpected = foundAdvisories.filter(advisory => !allowedAdvisories.has(advisory));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected high/critical advisories: ${unexpected.join(', ')}`);
  }

  for (const exception of exceptions) {
    if (exception.advisories.some(advisory => foundAdvisories.includes(advisory))) {
      validateException(exception, report, targetDirectory);
    }
  }

  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(
    `npm audit guard: PASS - ${counts.high ?? 0} high / ${counts.critical ?? 0} critical graph entries resolve only to ${foundAdvisories.join(', ')}`,
  );
};

const invokedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(
      `npm audit guard: FAIL - ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
