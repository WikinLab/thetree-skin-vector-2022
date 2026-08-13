#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  checkoutExactCommit,
  mapConcurrent,
  requiredSparsePaths,
  shouldPersistTrackedInputs
} from './bootstrap-upstream.mjs';
import { readGitBlobs } from './shared/git-blobs.mjs';

const gitExecutable = process.platform === 'win32' ? 'git.exe' : 'git';

function git(cwd, args) {
  const result = spawnSync(gitExecutable, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with status ${result.status}.\n${result.stderr || result.stdout || ''}`);
  }
  return String(result.stdout || '').trim();
}

async function testConcurrencyLimit() {
  let active = 0;
  let maximum = 0;
  const results = await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
}

function testTrackedInputWritePolicy() {
  assert.equal(shouldPersistTrackedInputs({}), false);
  assert.equal(shouldPersistTrackedInputs({ clean: true }), false);
  assert.equal(shouldPersistTrackedInputs({ verify: true }), false);
  assert.equal(shouldPersistTrackedInputs({ refresh: true }), true);
  assert.equal(shouldPersistTrackedInputs({ release: '1.47' }), true);
}

function testLessClosureSparseDiscovery() {
  const paths = requiredSparsePaths({
    sourceInventory: {
      vendorLessClosure: {
        schema: 3,
        repositoryDiscoveryPatterns: ['**/*.less', '**/*.css']
      },
      vendorFiles: [{
        path: 'vendor/upstream/resources/module/index.less',
        repository: 'fixture',
        upstreamPath: 'resources/module/index.less'
      }]
    }
  }, { name: 'fixture', bootstrapPaths: [] });
  assert.deepEqual(paths, [
    '**/*.css',
    '**/*.less',
    'resources/module/**',
    'resources/module/index.less'
  ]);
}

async function testExactShallowSparseCheckout(temporaryRoot) {
  const remote = path.join(temporaryRoot, 'remote.git');
  const source = path.join(temporaryRoot, 'source');
  const checkout = path.join(temporaryRoot, 'checkout');
  const invalidCheckout = path.join(temporaryRoot, 'invalid-checkout');
  fs.mkdirSync(source, { recursive: true });
  git(temporaryRoot, ['init', '--bare', '--quiet', remote]);
  git(source, ['init', '--quiet', '--initial-branch=main']);
  git(source, ['config', 'user.name', 'Bootstrap Contract']);
  git(source, ['config', 'user.email', 'bootstrap-contract@example.invalid']);
  git(source, ['config', 'core.longpaths', 'true']);

  const longRelativePath = path.join(
    'shared',
    `long-${'a'.repeat(70)}`,
    `long-${'b'.repeat(70)}`,
    `long-${'c'.repeat(70)}`,
    'mw.rcfilters.ui.ChangesListWrapperWidget.highlightCircles.seenunseen.less'
  );
  assert.ok(path.resolve(checkout, longRelativePath).length > 260);

  for (let index = 0; index < 6; index += 1) {
    fs.mkdirSync(path.join(source, 'kept'), { recursive: true });
    fs.mkdirSync(path.join(source, 'kept', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(source, 'shared'), { recursive: true });
    fs.mkdirSync(path.join(source, 'discarded'), { recursive: true });
    fs.writeFileSync(path.join(source, 'kept', 'value.txt'), `${index}\n`);
    fs.writeFileSync(path.join(source, 'kept', 'other.txt'), `other-${index}\n`);
    fs.writeFileSync(path.join(source, 'kept', 'nested', 'import.less'), `nested-${index}\n`);
    fs.writeFileSync(path.join(source, 'shared', 'outside.less'), `outside-${index}\n`);
    fs.mkdirSync(path.dirname(path.join(source, longRelativePath)), { recursive: true });
    fs.writeFileSync(path.join(source, longRelativePath), `long-${index}\n`);
    fs.writeFileSync(path.join(source, 'shared', 'not-style.txt'), `not-style-${index}\n`);
    fs.writeFileSync(path.join(source, 'discarded', 'value.txt'), `${index}\n`);
    git(source, ['add', '.']);
    git(source, ['commit', '--quiet', '-m', `commit ${index}`]);
  }
  const commit = git(source, ['rev-parse', 'HEAD']);
  git(source, ['push', '--quiet', remote, 'HEAD:refs/heads/main']);
  const url = pathToFileURL(remote).href;

  await checkoutExactCommit({
    checkout,
    url,
    commit,
    sparsePaths: ['kept/**', '**/*.less', '**/*.css'],
    label: 'contract-fixture'
  });

  assert.equal(git(checkout, ['rev-parse', 'HEAD']), commit);
  assert.equal(git(checkout, ['rev-list', '--count', 'HEAD']), '1');
  assert.equal(git(checkout, ['rev-parse', '--is-shallow-repository']), 'true');
  assert.equal(git(checkout, ['config', '--get', 'core.longpaths']), 'true');
  assert.equal(git(checkout, ['for-each-ref', '--format=%(refname)', 'refs/remotes']), '');
  assert.equal(fs.readFileSync(path.join(checkout, 'kept', 'value.txt'), 'utf8'), '5\n');
  assert.equal(fs.readFileSync(path.join(checkout, 'kept', 'nested', 'import.less'), 'utf8'), 'nested-5\n');
  assert.equal(fs.readFileSync(path.join(checkout, 'shared', 'outside.less'), 'utf8'), 'outside-5\n');
  assert.equal(fs.readFileSync(path.join(checkout, longRelativePath), 'utf8'), 'long-5\n');
  assert.equal(fs.existsSync(path.join(checkout, 'shared', 'not-style.txt')), false);
  assert.equal(fs.existsSync(path.join(checkout, 'discarded')), false);
  const specs = [`${commit}:kept/value.txt`, `${commit}:kept/other.txt`];
  const blobs = readGitBlobs(checkout, specs);
  assert.equal(blobs.get(specs[0]).toString('utf8'), '5\n');
  assert.equal(blobs.get(specs[1]).toString('utf8'), 'other-5\n');

  await assert.rejects(
    checkoutExactCommit({
      checkout: invalidCheckout,
      url,
      commit: 'f'.repeat(40),
      sparsePaths: ['kept/**'],
      label: 'invalid-contract-fixture'
    }),
    /Unable to fetch locked commit for invalid-contract-fixture/
  );

  fs.renameSync(remote, `${remote}.offline`);
  await checkoutExactCommit({
    checkout,
    url,
    commit,
    sparsePaths: ['kept/**', '**/*.less', '**/*.css'],
    label: 'offline-contract-fixture'
  });
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), commit);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-bootstrap-checkout-'));
try {
  testTrackedInputWritePolicy();
  testLessClosureSparseDiscovery();
  await testConcurrencyLimit();
  await testExactShallowSparseCheckout(temporaryRoot);
  console.log('Bootstrap checkout contract test passed.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
