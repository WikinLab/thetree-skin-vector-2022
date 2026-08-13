#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const lock = JSON.parse(read('UPSTREAM-LOCK.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const notice = read('NOTICE');
const thirdParty = read('THIRD_PARTY_NOTICES.md');

for (const repository of lock.repositories || []) {
  assert.match(notice, new RegExp(repository.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(notice, new RegExp(repository.commit));
  assert.match(notice, new RegExp(repository.license.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const declaredRepositories = [...notice.matchAll(/^\s+Repository:\s+(\S+)$/gm)].map((match) => match[1]);
const lockedRepositories = new Set((lock.repositories || []).map((repository) => repository.repository));
for (const repository of declaredRepositories) {
  assert.ok(lockedRepositories.has(repository), `NOTICE declares unlocked repository ${repository}`);
}

for (const dependency of Object.keys(packageLock.packages?.['']?.dependencies || {})) {
  const metadata = JSON.parse(read(`node_modules/${dependency}/package.json`));
  assert.match(notice, new RegExp(`\\b${dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  assert.match(thirdParty, new RegExp(metadata.license.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const tracked = spawnSync('git', [
  '-c', `safe.directory=${root.replaceAll('\\', '/')}`,
  'ls-files', '-z'
], { cwd: root, encoding: 'utf8', windowsHide: true });
if (tracked.status !== 0) throw new Error(tracked.stderr || 'Unable to enumerate tracked files');
const forbidden = tracked.stdout.split('\0').filter(Boolean).filter((file) =>
  file.startsWith('.upstream/') || file.startsWith('vendor/') || file.startsWith('node_modules/') ||
  file.startsWith('css/vendor/') || file.startsWith('lib/generated/')
);
assert.deepEqual(forbidden, [], `Materialized files are tracked: ${forbidden.join(', ')}`);

console.log('Distribution contract passed.');
