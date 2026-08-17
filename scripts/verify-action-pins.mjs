#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTION_SHA = /@[0-9a-f]{40}$/;
const USES_LINE = /^\s*-?\s*(?:uses|"uses"|'uses')\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/;

export const findMutableActionReferencesInSource = (source, filename = '<input>') => {
  const violations = [];
  source.split(/\r?\n/).forEach((line, index) => {
    const match = USES_LINE.exec(line);
    if (!match) return;
    const target = match[1] ?? match[2] ?? match[3] ?? '';
    if (target.startsWith('./')) return;
    if (!ACTION_SHA.test(target)) {
      violations.push({ filename, line: index + 1, target });
    }
  });
  return violations;
};

const workflowFiles = async directory => {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map(entry => path.join(directory, entry.name));
};

export const verifyActionPins = async directory => {
  const files = await workflowFiles(directory);
  const violations = [];
  for (const filename of files) {
    const source = await readFile(filename, 'utf8');
    violations.push(...findMutableActionReferencesInSource(source, filename));
  }
  return violations;
};

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const root = path.resolve(process.argv[2] ?? '.github/workflows');
  const violations = await verifyActionPins(root);
  if (violations.length > 0) {
    for (const item of violations) {
      console.error(`${item.filename}:${item.line}: mutable external action ${item.target}`);
    }
    console.error('Every external GitHub Action must be pinned to a lowercase 40-character SHA.');
    process.exitCode = 1;
  }
}
